/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  isCanonicalText,
  isFunction,
  isObjectLike,
  isPlainObject,
  stableValue,
} from "@noobot/shared/value";
import { requireMessageDiagnostics } from "./message-diagnostics.js";
import { isMessageContentVersion } from "./message-content-version.js";
import { isMessageCreationOwner, sameMessageCreationOwner } from "./message-creation-owner.js";
import { isPartitionEpoch } from "./partition-epoch.js";
import { captureJournalJson } from "./partition-journal-json.js";
import { parseMessageDeleteRequest } from "./command/message-delete-command.js";
import { parseTurnReplacementChange } from "./command/turn-replace-command.js";
export * from "./message-diagnostics.js";
export { sameMessageCreationOwner } from "./message-creation-owner.js";

export function requireSessionOperationId(operationId) {
  if (
    typeof operationId !== "string" ||
    !operationId ||
    operationId.length > 1024 ||
    new TextEncoder().encode(operationId).length > 1024
  )
    throw new TypeError("Session operationId must be a bounded non-empty string");
  return operationId;
}

const COMMIT_COMMAND_FIELDS = ["operationId", "changes", "committedAt"];
const PREPARED_REQUEST_FIELDS = ["epoch", "expectedGeneration", "operationId", "input"];
const COMMIT_INPUT_FIELDS = ["changes", "committedAt"];

function requireCommitGeneration(generation) {
  if (!Number.isSafeInteger(generation) || generation < 0)
    throw new SessionCommitInputError("Session submission requires a valid expected generation");
}

function hasExactCommitFields(request, fields) {
  return (
    isPlainObject(request) &&
    Object.getPrototypeOf(request) === Object.prototype &&
    Reflect.ownKeys(request).length === fields.length &&
    fields.every((field) => {
      const descriptor = Object.getOwnPropertyDescriptor(request, field);
      return descriptor?.enumerable && Object.hasOwn(descriptor, "value");
    })
  );
}

function requireCommitFields(request, fields) {
  if (
    !hasExactCommitFields(request, fields) ||
    typeof request.committedAt !== "string" ||
    !Number.isFinite(Date.parse(request.committedAt))
  )
    throw new TypeError("Session submission requires a complete commit request");
  requireSessionOperationId(request.operationId);
}

const capturedInputBytes = new WeakMap();
const preparedRequests = new WeakSet();

export function captureSessionTransactionInput(input, options) {
  const bytes = capturedInputBytes.get(input);
  if (bytes !== undefined) {
    if (options && bytes > options.budget) throw options.budgetError();
    return input;
  }
  const captured = captureJournalJson(input, options);
  if (isObjectLike(captured.value)) capturedInputBytes.set(captured.value, captured.bytes);
  return captured.value;
}

function captureCommitInput({ changes, committedAt }, options) {
  return captureSessionTransactionInput({ changes, committedAt }, options);
}

export function prepareScopedSessionCommitRequest({ epoch, expectedGeneration }, command, options) {
  requireCommitGeneration(expectedGeneration);
  if (epoch !== null && !isPartitionEpoch(epoch))
    throw new TypeError("Invalid session commit epoch");
  requireCommitFields(command, COMMIT_COMMAND_FIELDS);
  const input = captureCommitInput(command, options);
  const request = Object.freeze({
    epoch,
    expectedGeneration,
    operationId: command.operationId,
    input,
  });
  preparedRequests.add(request);
  return request;
}

export function restoreSessionCommitRequest(serialized) {
  if (typeof serialized !== "string")
    throw new TypeError("Session replay requires a serialized commit request");
  const request = JSON.parse(serialized);
  if (
    !hasExactCommitFields(request, PREPARED_REQUEST_FIELDS) ||
    !hasExactCommitFields(request.input, COMMIT_INPUT_FIELDS)
  )
    throw new TypeError("Session replay requires a complete prepared request");
  const { epoch, expectedGeneration, operationId, input } = request;
  return prepareScopedSessionCommitRequest(
    { epoch, expectedGeneration },
    { operationId, ...input },
  );
}

export function requirePreparedSessionCommitRequest(request) {
  if (!preparedRequests.has(request))
    throw new TypeError("Session submission requires a reader-prepared request");
  return request;
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
          request = requirePreparedSessionCommitRequest(await prepare());
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
  messageContentReplacements: "array",
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

export class SessionCommitInputError extends TypeError {
  code = "SESSION_COMMIT_INPUT_INVALID";
}

function requireSessionMessageDiagnostics(changes) {
  if (!changes.messageDiagnostics) return;
  try {
    requireMessageDiagnostics(changes.messageDiagnostics, changes.messages ?? []);
  } catch (cause) {
    if (!(cause instanceof TypeError) && cause.code !== "EXECUTION_LOG_RECORD_TOO_LARGE")
      throw cause;
    throw new SessionCommitInputError(cause.message, { cause });
  }
}

export function requireSessionChanges(changes) {
  if (!isPlainObject(changes) || !Object.keys(changes).length)
    throw new SessionCommitInputError("Session changes require a non-empty delta");
  const entries = Object.entries(changes);
  for (const [key, value] of entries) {
    if (!Object.hasOwn(CHANGE_SHAPES, key))
      throw new SessionCommitInputError(`Unsupported session change: ${key}`);
    const shape = CHANGE_SHAPES[key];
    if (!(shape === "array" ? Array.isArray(value) : isPlainObject(value)))
      throw new SessionCommitInputError(`Session ${key} must be an ${shape}`);
    if (key === "userMetaParsedResult") requireUserMetaParsedResult(value);
    if (entries.length !== 1 && Object.hasOwn(INDEPENDENT_OPERATIONS, key))
      throw new SessionCommitInputError(
        `${INDEPENDENT_OPERATIONS[key]} must be an independent session operation`,
      );
  }
  try {
    if (changes.messageDeletion) parseMessageDeleteRequest(changes.messageDeletion);
    if (changes.turnReplacement) parseTurnReplacementChange(changes.turnReplacement);
  } catch (cause) {
    if (!(cause instanceof TypeError)) throw cause;
    throw new SessionCommitInputError(cause.message, { cause });
  }
  requireMessageOperationConsistency(changes);
  requireSessionMessageDiagnostics(changes);
  return changes;
}

export function requireImmutableSessionChanges(changes) {
  requireSessionChanges(changes);
  if (
    Object.hasOwn(changes, "messageContentReplacements") ||
    changes.summaryCheckpoints?.some((checkpoint) =>
      Object.hasOwn(checkpoint, "messageContentReplacements"),
    )
  ) {
    throw Object.assign(
      new Error("Immutable storage does not support message content replacements"),
      {
        code: "SESSION_CHANGE_UNSUPPORTED",
        statusCode: 409,
      },
    );
  }
  return changes;
}

export function requireUserMetaParsedResultAttachmentRef(result) {
  if (!isPlainObject(result))
    throw new SessionCommitInputError("user_meta parsed result must be an object");
  if (!isCanonicalText(result.sourceAttachmentRef))
    throw new SessionCommitInputError("user_meta parsed result requires sourceAttachmentRef");
  return result.sourceAttachmentRef;
}

export function mergeUserMetaParsedResults(current = [], result) {
  const resultRef = requireUserMetaParsedResultAttachmentRef(result);
  if (!Array.isArray(current)) throw new TypeError("userMetaParsedResults must be an array");
  return [
    ...current.filter((item) => requireUserMetaParsedResultAttachmentRef(item) !== resultRef),
    JSON.parse(JSON.stringify(result)),
  ];
}

export function requireUserMetaParsedResultReceipt(receipt, requestedResult) {
  if (!isPlainObject(receipt) || !Array.isArray(receipt.userMetaParsedResults))
    throw new TypeError("Session user_meta receipt requires userMetaParsedResults");
  const requestedRef = requireUserMetaParsedResultAttachmentRef(requestedResult);
  const seen = new Set();
  let committed;
  for (const result of receipt.userMetaParsedResults) {
    const ref = requireUserMetaParsedResultAttachmentRef(result);
    if (seen.has(ref)) throw new TypeError("Session user_meta receipt contains duplicate results");
    seen.add(ref);
    if (ref === requestedRef) committed = result;
  }
  if (
    !committed ||
    JSON.stringify(stableValue(committed)) !== JSON.stringify(stableValue(requestedResult))
  )
    throw new TypeError("Session user_meta receipt does not contain the requested result");
  return receipt;
}

function requireUserMetaParsedResult(value) {
  if (Object.keys(value).length !== 2 || !isCanonicalText(value.messageUid))
    throw new SessionCommitInputError("User meta parsed result requires messageUid and result");
  requireUserMetaParsedResultAttachmentRef(value.result);
}

function fullMessageIdentities(changes) {
  const identities = new Set();
  for (const message of changes.messages ?? []) {
    if (!isPlainObject(message))
      throw new SessionCommitInputError("Session message must be an object");
    identities.add(message.messageUid);
  }
  for (const checkpoint of changes.summaryCheckpoints ?? []) {
    for (const message of checkpoint.messages ?? []) identities.add(message.messageUid);
  }
  return identities;
}

function collectContentWrites(changes, fullMessages) {
  const writes = new Map();
  for (const [operations, requireWrite] of [
    [changes.messageContentAppends, requireMessageContentAppend],
    [changes.messageContentReplacements, requireMessageContentReplacement],
  ]) {
    addContentWrites(writes, fullMessages, operations, requireWrite);
  }
  return writes;
}

function addContentWrites(writes, fullMessages, operations, requireWrite) {
  for (const write of operations ?? []) {
    requireWrite(write);
    if (writes.has(write.messageUid) || fullMessages.has(write.messageUid))
      throw new SessionCommitInputError(
        "A message requires exactly one content operation per transaction",
      );
    writes.set(write.messageUid, write);
  }
}

function requireMessageOperationConsistency(changes) {
  const fullMessages = fullMessageIdentities(changes);
  const writes = collectContentWrites(changes, fullMessages);
  const updates = new Set();
  for (const update of changes.messageMetadataUpdates ?? []) {
    requireMessageMetadataUpdate(update);
    if (updates.has(update.messageUid) || fullMessages.has(update.messageUid))
      throw new SessionCommitInputError(
        "A message requires exactly one metadata operation per transaction",
      );
    const write = writes.get(update.messageUid);
    if (
      write &&
      (!sameMessageCreationOwner(write.owner, update.owner) ||
        ["dialogProcessId", "turnScopeId", "expectedContentReference"].some(
          (field) => write[field] !== update[field],
        ))
    )
      throw new SessionCommitInputError(
        "Message operations require the same ownership and content version",
      );
    updates.add(update.messageUid);
  }
}

export function requireMessageContentAppend(append) {
  return requireMessageContentWrite(append, "append");
}

export function requireMessageContentReplacement(replacement) {
  return requireMessageContentWrite(replacement, "replacement");
}

function requireMessageContentWrite(write, kind) {
  const fields = [
    "messageUid",
    "dialogProcessId",
    "turnScopeId",
    "expectedContentReference",
    "owner",
    "content",
  ];
  if (
    !isPlainObject(write) ||
    Object.keys(write).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(write, field)) ||
    fields
      .slice(0, 3)
      .some(
        (field) =>
          typeof write[field] !== "string" ||
          !write[field].trim() ||
          write[field] !== write[field].trim(),
      ) ||
    !isMessageContentVersion(write.expectedContentReference) ||
    !isMessageCreationOwner(write.owner) ||
    typeof write.content !== "string" ||
    (kind === "append" && write.content.length === 0)
  )
    throw new SessionCommitInputError(`Invalid message content ${kind}`);
  return write;
}

const isBoolean = (value) => typeof value === "boolean";
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

function rejectUserAttachmentUpdate() {
  throw new SessionCommitInputError(
    "Existing user message attachments require the binding command",
  );
}

export function requireUnchangedUserMessageAttachments(previous, next) {
  if (previous.role !== "user" || previous.attachments === next.attachments) return;
  if (
    JSON.stringify(stableValue(previous.attachments ?? [])) !==
    JSON.stringify(stableValue(next.attachments ?? []))
  )
    rejectUserAttachmentUpdate();
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
  requireUnchangedUserMessageAttachments(previous, message);
  const identity = {
    messageUid: message.messageUid,
    dialogProcessId: message.dialogProcessId || ownership.dialogProcessId,
    turnScopeId: message.turnScopeId || ownership.turnScopeId,
    expectedContentReference: receipt.contentReference,
    owner: receipt.owner,
  };
  const changedFields = [...new Set([...Object.keys(previous), ...Object.keys(message)])].filter(
    (field) =>
      !(field === "attachments" && previous.role === "user") && previous[field] !== message[field],
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

export function* projectMessagePersistenceEntries(entries, ownership) {
  for (const entry of entries) {
    const { message, persisted, contentAppend } = entry;
    yield {
      entry,
      delta: projectMessagePersistenceChange(message, persisted, ownership, contentAppend),
    };
  }
}

export function mergeMessagePersistenceDeltas(deltas) {
  const changes = { messages: [], messageContentAppends: [], messageMetadataUpdates: [] };
  for (const delta of deltas)
    for (const [field, values] of Object.entries(delta)) changes[field].push(...values);
  return changes;
}

export function projectMessagePersistenceChanges(entries, ownership) {
  return mergeMessagePersistenceDeltas(
    Array.from(projectMessagePersistenceEntries(entries, ownership), ({ delta }) => delta),
  );
}

export function requireMessageMetadataUpdate(update) {
  const fields = [
    "messageUid",
    "dialogProcessId",
    "turnScopeId",
    "expectedContentReference",
    "owner",
    "metadata",
    "metadataRemovals",
  ];
  if (
    !isPlainObject(update) ||
    Object.keys(update).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(update, field)) ||
    fields
      .slice(0, 3)
      .some(
        (field) =>
          typeof update[field] !== "string" ||
          !update[field].trim() ||
          update[field] !== update[field].trim(),
      ) ||
    !isMessageContentVersion(update.expectedContentReference) ||
    !isMessageCreationOwner(update.owner) ||
    !isPlainObject(update.metadata) ||
    Object.keys(update.metadata).some((field) => !MESSAGE_METADATA_UPDATE_FIELDS.includes(field)) ||
    !Array.isArray(update.metadataRemovals) ||
    new Set(update.metadataRemovals).size !== update.metadataRemovals.length ||
    update.metadataRemovals.some(
      (field) =>
        !MESSAGE_METADATA_UPDATE_FIELDS.includes(field) || Object.hasOwn(update.metadata, field),
    )
  )
    throw new SessionCommitInputError("Invalid message metadata update");
  for (const [field, value] of Object.entries(update.metadata)) {
    if (!MESSAGE_METADATA_VALIDATORS[field](value))
      throw new SessionCommitInputError(`Invalid message metadata field: ${field}`);
  }
  return update;
}

export function applyMessageMetadataUpdate(message, update) {
  requireMessageMetadataUpdate(update);
  if (
    message.role === "user" &&
    (Object.hasOwn(update.metadata, "attachments") ||
      update.metadataRemovals.includes("attachments"))
  )
    rejectUserAttachmentUpdate();
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
    "owner",
    "generation",
    "activityEventIds",
  ];
  if (
    !isPlainObject(receipt) ||
    Object.keys(receipt).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(receipt, field)) ||
    fields
      .slice(0, 4)
      .some(
        (field) =>
          typeof receipt[field] !== "string" ||
          !receipt[field].trim() ||
          receipt[field] !== receipt[field].trim(),
      ) ||
    !isMessageContentVersion(receipt.contentReference) ||
    !isMessageCreationOwner(receipt.owner) ||
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

export function createMessagePersistenceReceipt(message, generation, contentReference, owner) {
  return requireMessagePersistenceReceipt({
    sessionId: message.sessionId,
    messageUid: message.messageUid,
    dialogProcessId: message.dialogProcessId,
    turnScopeId: message.turnScopeId,
    contentReference,
    owner,
    generation,
    activityEventIds: (message.activityTimeline ?? []).map((activity) => activity.eventId),
  });
}
