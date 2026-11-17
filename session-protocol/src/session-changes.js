/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isFunction, isObjectLike, isPlainObject } from "@noobot/shared/value";
import { requireMessageDiagnostics } from "./message-diagnostics.js";
export * from "./message-diagnostics.js";

function freezeSubmissionValue(value) {
  if (isObjectLike(value)) {
    for (const child of Object.values(value)) freezeSubmissionValue(child);
    Object.freeze(value);
  }
  return value;
}

export function createSessionChangesSubmission() {
  let owner;
  let request;
  let inFlight;
  return Object.freeze({
    submit({ userId, sessionId, prepare, commit }) {
      if (
        typeof userId !== "string" ||
        !userId ||
        typeof sessionId !== "string" ||
        !sessionId ||
        !isFunction(prepare) ||
        !isFunction(commit)
      )
        throw new TypeError("Session submission requires its owner, prepare and commit");
      if (owner && (owner.userId !== userId || owner.sessionId !== sessionId))
        throw new TypeError("Session submission ownership mismatch");
      owner = { userId, sessionId };
      if (inFlight) return inFlight;
      const run = async () => {
        if (!request) {
          const prepared = JSON.parse(JSON.stringify(await prepare()));
          requireSessionChanges(prepared.changes);
          if (
            !Number.isSafeInteger(prepared.expectedGeneration) ||
            prepared.expectedGeneration < 0 ||
            typeof prepared.operationId !== "string" ||
            !prepared.operationId.trim() ||
            prepared.operationId !== prepared.operationId.trim() ||
            typeof prepared.committedAt !== "string" ||
            !Number.isFinite(Date.parse(prepared.committedAt))
          )
            throw new TypeError("Session submission requires a complete commit request");
          request = freezeSubmissionValue(prepared);
        }
        return commit(request);
      };
      inFlight = run().then(
        (result) => {
          inFlight = null;
          return result;
        },
        (error) => {
          inFlight = null;
          throw error;
        },
      );
      return inFlight;
    },
  });
}

const CHANGE_SHAPES = Object.freeze({
  messages: "array",
  messageDiagnostics: "array",
  messageContentAppends: "array",
  messageMetadataUpdates: "array",
  turnTransition: "object",
  summaryCheckpoints: "array",
  artifactEvents: "array",
  sessionMetadata: "object",
  scopedMetadata: "object",
  timings: "array",
  deliveries: "array",
  outboxCursors: "array",
  outboxMaintenance: "object",
  outboxTurnRemoval: "object",
  attachmentBinding: "object",
  userMetaParsedResult: "object",
  messageDeletion: "object",
  turnReplacement: "object",
});

const INDEPENDENT_OPERATIONS = Object.freeze({
  attachmentBinding: "Attachment binding",
  userMetaParsedResult: "User meta parsed result",
  messageDeletion: "Message deletion",
  turnReplacement: "Turn replacement",
});

export function requireSessionChanges(changes) {
  if (!isPlainObject(changes) || !Object.keys(changes).length)
    throw new TypeError("Session changes require a non-empty delta");
  const entries = Object.entries(changes);
  for (const [key, value] of entries) {
    if (!Object.hasOwn(CHANGE_SHAPES, key))
      throw new TypeError(`Unsupported session change: ${key}`);
    const shape = CHANGE_SHAPES[key];
    if (!(shape === "array" ? Array.isArray(value) : isPlainObject(value)))
      throw new TypeError(`Session ${key} must be an ${shape}`);
    if (key === "userMetaParsedResult") requireUserMetaParsedResult(value);
    if (entries.length !== 1 && Object.hasOwn(INDEPENDENT_OPERATIONS, key))
      throw new TypeError(
        `${INDEPENDENT_OPERATIONS[key]} must be an independent session operation`,
      );
  }
  requireMessageOperationConsistency(changes);
  if (changes.messageDiagnostics)
    requireMessageDiagnostics(changes.messageDiagnostics, changes.messages ?? []);
  return changes;
}

function requireUserMetaParsedResult(value) {
  if (
    Object.keys(value).length !== 2 ||
    typeof value.messageUid !== "string" ||
    !value.messageUid.trim() ||
    value.messageUid !== value.messageUid.trim() ||
    !isPlainObject(value.result)
  )
    throw new TypeError("User meta parsed result requires messageUid and result");
}

function fullMessageIdentities(changes) {
  const identities = new Set((changes.messages ?? []).map((message) => message.messageUid));
  for (const checkpoint of changes.summaryCheckpoints ?? []) {
    for (const message of checkpoint.messages ?? []) identities.add(message.messageUid);
  }
  return identities;
}

function requireMessageOperationConsistency(changes) {
  const fullMessages = fullMessageIdentities(changes);
  const appends = new Map();
  for (const append of changes.messageContentAppends ?? []) {
    requireMessageContentAppend(append);
    if (appends.has(append.messageUid) || fullMessages.has(append.messageUid))
      throw new TypeError("A message requires exactly one content operation per transaction");
    appends.set(append.messageUid, append);
  }
  const updates = new Set();
  for (const update of changes.messageMetadataUpdates ?? []) {
    requireMessageMetadataUpdate(update);
    if (updates.has(update.messageUid) || fullMessages.has(update.messageUid))
      throw new TypeError("A message requires exactly one metadata operation per transaction");
    const append = appends.get(update.messageUid);
    if (
      append &&
      ["dialogProcessId", "turnScopeId", "expectedContentReference"].some(
        (field) => append[field] !== update[field],
      )
    )
      throw new TypeError("Message operations require the same ownership and content version");
    updates.add(update.messageUid);
  }
}

export function requireMessageContentAppend(append) {
  const fields = [
    "messageUid",
    "dialogProcessId",
    "turnScopeId",
    "expectedContentReference",
    "content",
  ];
  if (
    !isPlainObject(append) ||
    Object.keys(append).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(append, field)) ||
    fields
      .slice(0, -1)
      .some(
        (field) =>
          typeof append[field] !== "string" ||
          !append[field].trim() ||
          append[field] !== append[field].trim(),
      ) ||
    typeof append.content !== "string" ||
    append.content.length === 0
  )
    throw new TypeError("Invalid message content append");
  return append;
}

const isBoolean = (value) => typeof value === "boolean";
const isCanonicalText = (value) =>
  typeof value === "string" && !!value.trim() && value === value.trim();
const isNullableObject = (value) => value === null || isPlainObject(value);
const MESSAGE_METADATA_VALIDATORS = Object.freeze({
  chatPresentation: isBoolean,
  workspaceRootDirectory: isCanonicalText,
  summarized: isBoolean,
  activityTimeline: Array.isArray,
  toolTimeline: Array.isArray,
  modelResponseMetadata: isNullableObject,
  modelAdditionalKwargs: isNullableObject,
  attachments: Array.isArray,
  transferEnvelopes: Array.isArray,
});

export const MESSAGE_METADATA_UPDATE_FIELDS = Object.freeze(
  Object.keys(MESSAGE_METADATA_VALIDATORS),
);

function requireAcknowledgedMessageOwnership(message, receipt, ownership) {
  if (
    message.messageUid !== receipt.messageUid ||
    (message.sessionId !== undefined && message.sessionId !== receipt.sessionId) ||
    (message.dialogProcessId || ownership.dialogProcessId) !== receipt.dialogProcessId ||
    (message.turnScopeId || ownership.turnScopeId) !== receipt.turnScopeId
  )
    throw new TypeError("Acknowledged message ownership mismatch");
}

export function projectMessagePersistenceChange(
  message,
  persisted,
  ownership,
  contentAppend = null,
) {
  if (!persisted) return { messages: [message] };
  const { receipt, message: previous } = persisted;
  requireMessagePersistenceReceipt(receipt);
  requireAcknowledgedMessageOwnership(message, receipt, ownership);
  requireAcknowledgedMessageOwnership(previous, receipt, ownership);
  if (ownership.sessionId !== receipt.sessionId)
    throw new TypeError("Acknowledged message ownership mismatch");
  const identity = {
    messageUid: message.messageUid,
    dialogProcessId: message.dialogProcessId || ownership.dialogProcessId,
    turnScopeId: message.turnScopeId || ownership.turnScopeId,
    expectedContentReference: receipt.contentReference,
  };
  const changedFields = [...new Set([...Object.keys(previous), ...Object.keys(message)])].filter(
    (field) => previous[field] !== message[field],
  );
  if (
    changedFields.some(
      (field) => field !== "content" && !MESSAGE_METADATA_UPDATE_FIELDS.includes(field),
    ) ||
    (message.content !== previous.content && contentAppend === null)
  )
    return { messages: [message] };
  const metadata = Object.fromEntries(
    changedFields
      .filter((field) => field !== "content" && message[field] !== undefined)
      .map((field) => [field, message[field]]),
  );
  const metadataRemovals = changedFields.filter(
    (field) => field !== "content" && message[field] === undefined,
  );
  const changes = {};
  if (contentAppend !== null)
    changes.messageContentAppends = [
      requireMessageContentAppend({ ...identity, content: contentAppend }),
    ];
  if (Object.keys(metadata).length || metadataRemovals.length || contentAppend === null)
    changes.messageMetadataUpdates = [
      requireMessageMetadataUpdate({ ...identity, metadata, metadataRemovals }),
    ];
  return changes;
}

export function projectMessagePersistenceChanges(messages, persistedMessages, ownership) {
  const persistedByUid = new Map(persistedMessages.map((entry) => [entry.messageUid, entry]));
  const changes = { messages: [], messageContentAppends: [], messageMetadataUpdates: [] };
  for (const message of messages) {
    const persisted = persistedByUid.get(message.messageUid);
    const projected = projectMessagePersistenceChange(
      message,
      persisted?.persisted,
      ownership,
      persisted?.contentAppend,
    );
    for (const [field, values] of Object.entries(projected)) changes[field].push(...values);
  }
  return changes;
}

export function requireMessageMetadataUpdate(update) {
  const fields = [
    "messageUid",
    "dialogProcessId",
    "turnScopeId",
    "expectedContentReference",
    "metadata",
    "metadataRemovals",
  ];
  if (
    !isPlainObject(update) ||
    Object.keys(update).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(update, field)) ||
    fields
      .slice(0, -2)
      .some(
        (field) =>
          typeof update[field] !== "string" ||
          !update[field].trim() ||
          update[field] !== update[field].trim(),
      ) ||
    !isPlainObject(update.metadata) ||
    Object.keys(update.metadata).some((field) => !MESSAGE_METADATA_UPDATE_FIELDS.includes(field)) ||
    !Array.isArray(update.metadataRemovals) ||
    new Set(update.metadataRemovals).size !== update.metadataRemovals.length ||
    update.metadataRemovals.some(
      (field) =>
        !MESSAGE_METADATA_UPDATE_FIELDS.includes(field) || Object.hasOwn(update.metadata, field),
    )
  )
    throw new TypeError("Invalid message metadata update");
  for (const [field, value] of Object.entries(update.metadata)) {
    if (!MESSAGE_METADATA_VALIDATORS[field](value))
      throw new TypeError(`Invalid message metadata field: ${field}`);
  }
  return update;
}

export function applyMessageMetadataUpdate(message, update) {
  requireMessageMetadataUpdate(update);
  const next = { ...message, ...update.metadata };
  for (const field of update.metadataRemovals) delete next[field];
  return next;
}

export function requireMessagePersistenceReceipt(receipt) {
  const fields = [
    "sessionId",
    "messageUid",
    "dialogProcessId",
    "turnScopeId",
    "contentReference",
    "generation",
    "activityEventIds",
  ];
  if (
    !isPlainObject(receipt) ||
    Object.keys(receipt).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(receipt, field)) ||
    fields
      .slice(0, 5)
      .some(
        (field) =>
          typeof receipt[field] !== "string" ||
          !receipt[field].trim() ||
          receipt[field] !== receipt[field].trim(),
      ) ||
    !Number.isSafeInteger(receipt.generation) ||
    receipt.generation < 1 ||
    !Array.isArray(receipt.activityEventIds) ||
    receipt.activityEventIds.some(
      (id) => typeof id !== "string" || !id.trim() || id !== id.trim(),
    ) ||
    new Set(receipt.activityEventIds).size !== receipt.activityEventIds.length
  )
    throw new TypeError("Invalid message persistence receipt");
  return receipt;
}

export function createMessagePersistenceReceipt(message, generation, contentReference) {
  return requireMessagePersistenceReceipt({
    sessionId: message.sessionId,
    messageUid: message.messageUid,
    dialogProcessId: message.dialogProcessId,
    turnScopeId: message.turnScopeId,
    contentReference,
    generation,
    activityEventIds: (message.activityTimeline ?? []).map((activity) => activity.eventId),
  });
}
