/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isMessageIdentity } from "./identity/message-identity.js";
import { partitionEntityKey, requirePartitionEntityOwner } from "./partition-transaction.js";
import { PartitionAdmissionRejection, partitionJournalError } from "./partition-journal.js";
import { PARTITION_MESSAGE_CONTENT } from "./partition-collections.js";
import { requirePartitionContentBoundaries } from "./partition-message-content.js";
import {
  partitionCollectionResultBytes,
  requirePartitionCollectionPageLimit,
} from "./partition-collection-query.js";
import {
  createMessagePersistenceReceipt,
  requireSessionChanges,
  SessionCommitInputError,
} from "./session-changes.js";
import { isPlainObject } from "@noobot/shared/value";
import { requireStoredSessionTurnMembership } from "./session-reader.js";
import { assertTurnRecord } from "./lifecycle/turn-record.js";
import { projectTurnMessage } from "./lifecycle/turn-terminal.js";
import {
  normalizeTurnTimingRecord,
  normalizeTurnTimingRecords,
  requireTurnTimingOwnership,
} from "./lifecycle/turn-timing.js";
import { SESSION_ERROR_CODE, matchesSessionScopeIdentity } from "./errors.js";
import { attachmentBindingResult } from "./command/turn-attachment-bind-command.js";
import { SESSION_COMMAND } from "./command/session-command.js";
import { matchesTurnReplacementAnchor } from "./command/turn-replace-command.js";
import {
  nextSessionMessagePageCursor,
  requireSessionMessagePagePosition,
} from "./message-read-budget.js";
import {
  resolveSessionMessageSuffix,
  resolveSessionMessageSuffixEffect,
} from "./aggregate/message-suffix.js";
import { collectExactFieldErrors } from "./aggregate/sessions-summary.js";
import { isPartitionEpoch } from "./partition-epoch.js";

export function projectPartitionMessageEntry(record, lifecycle, owner) {
  return {
    message: projectTurnMessage(record.message, lifecycle),
    sessionOrdinal: record.sessionOrdinal,
    contentReference: record.contentVersion,
    owner,
  };
}

export const PARTITION_MESSAGE_COLLECTIONS = Object.freeze({
  turns: "turns",
  messages: "messages",
  order: "turnMessages",
  sessionOrder: "messageOrder",
  content: PARTITION_MESSAGE_CONTENT,
});

export const PARTITION_SESSION_MESSAGE_COUNT = Object.freeze({
  collection: "metadata",
  key: "messageCount",
});

const updateFields = Object.freeze([
  "messageContentAppends",
  "messageContentReplacements",
  "messageMetadataUpdates",
]);

function ownershipConflict() {
  throw new PartitionAdmissionRejection(
    "SESSION_TURN_IDENTITY_CONFLICT",
    "Turn belongs to another dialog",
  );
}

function requireStoredLifecycle(state) {
  try {
    assertTurnRecord(state);
  } catch (cause) {
    if (!(cause instanceof TypeError)) throw cause;
    throw Object.assign(partitionJournalError("SESSION_STORAGE_CORRUPT", cause.message), {
      cause,
    });
  }
}

function requireStoredTurnOwnership(key, mutation, state, dialogs) {
  const membership = mutation?.remove ? null : mutation;
  const turn = membership ? requireStoredSessionTurnMembership(membership.value) : null;
  if (
    (state && state.turnScopeId !== key) ||
    (turn && state && turn.dialogProcessId !== state.dialogProcessId)
  )
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Partition turn ownership disagrees");
  for (const dialog of dialogs)
    if ((turn && turn.dialogProcessId !== dialog) || (state && state.dialogProcessId !== dialog))
      ownershipConflict();
}

export async function requirePartitionMessageTurnOwnership(read, messages, transition) {
  const requested = new Map();
  for (const identity of transition ? [...messages, transition] : messages) {
    const { turnScopeId, dialogProcessId } = identity;
    if (!requested.has(turnScopeId)) requested.set(turnScopeId, new Set());

    if (Object.hasOwn(identity, "dialogProcessId")) requested.get(turnScopeId).add(dialogProcessId);
    if (requested.get(turnScopeId).size > 1) ownershipConflict();
  }
  if (!requested.size)
    return { turns: new Map(), lifecycle: new Map(), retiredLifecycle: new Set() };
  const keys = [...requested.keys()];
  const turns = await read({
    collection: PARTITION_MESSAGE_COLLECTIONS.turns,
    keys,
    includeOwner: true,
  });
  const lifecycleEntries = await read({ collection: "lifecycle", keys, includeOwner: true });
  const lifecycle = new Map();
  const retiredLifecycle = new Set();
  for (const [key, dialogs] of requested) {
    const mutation = lifecycleEntries.get(key)?.mutation;
    let state = null;
    if (mutation?.remove) retiredLifecycle.add(key);
    else if (mutation) {
      state = mutation.value;
      requireStoredLifecycle(state);
    }
    requireStoredTurnOwnership(key, turns.get(key)?.mutation, state, dialogs);
    lifecycle.set(key, state);
  }
  return { turns, lifecycle, retiredLifecycle };
}

export function requirePartitionTurnTimingOwnership(timing, { turns, lifecycle }) {
  const membership = turns.get(timing.turnScopeId)?.mutation;
  const turn = membership?.remove ? null : membership?.value;
  requireTurnTimingOwnership(
    timing,
    turn ? turn.dialogProcessId : lifecycle.get(timing.turnScopeId)?.dialogProcessId,
  );
}

export function requirePartitionTurnTimingRecord(value, turnScopeId, ownership) {
  try {
    const normalized = normalizeTurnTimingRecord(value);
    if (
      normalized.turnScopeId !== turnScopeId ||
      Object.keys(normalized).length !== Object.keys(value).length ||
      Object.entries(normalized).some(([key, field]) => value[key] !== field)
    )
      throw partitionJournalError(
        "SESSION_STORAGE_CORRUPT",
        "Invalid partition turn timing record",
      );
    requirePartitionTurnTimingOwnership(normalized, ownership);
  } catch (cause) {
    if (
      cause.code !== SESSION_ERROR_CODE.TURN_TIMING_INVALID &&
      cause.code !== SESSION_ERROR_CODE.TURN_TIMING_CONFLICT
    )
      throw cause;
    throw Object.assign(partitionJournalError("SESSION_STORAGE_CORRUPT", cause.message), { cause });
  }
  return value;
}

export async function requirePartitionVisibleMessageTurnOwnership(read, records, target) {
  const ownership = await requirePartitionMessageTurnOwnership(
    read,
    records.map(({ message: { turnScopeId } }) => ({ turnScopeId })),
    target,
  );
  const { turns } = ownership;
  for (const {
    message: { turnScopeId, dialogProcessId },
    turnOrdinal,
  } of records) {
    const membership = turns.get(turnScopeId)?.mutation;
    const turn = membership?.remove ? null : membership?.value;
    if (
      !turn ||
      turn.dialogProcessId !== dialogProcessId ||
      !Number.isSafeInteger(turnOrdinal) ||
      turnOrdinal < 1 ||
      turnOrdinal > turn.messageCount
    )
      throw partitionJournalError(
        "SESSION_STORAGE_CORRUPT",
        "Visible message disagrees with partition turn membership",
      );
  }
  if (!records.length) return ownership;
  const collection = PARTITION_MESSAGE_COLLECTIONS.order;
  const keys = records.map(({ message: { turnScopeId }, turnOrdinal }) =>
    partitionMessageEntryKey(collection, turnScopeId, turnOrdinal),
  );
  const positions = await read({ collection, keys: [...new Set(keys)] });
  for (const [
    index,
    {
      message: { messageUid },
    },
  ] of records.entries()) {
    if (!isMessageIdentity(messageUid) || positions.get(keys[index])?.value !== messageUid)
      throw partitionJournalError(
        "SESSION_STORAGE_CORRUPT",
        "Visible message disagrees with partition turn position",
      );
  }
  return ownership;
}

const directChangeFields = new Set([
  "artifactEvents",
  "sessionMetadata",
  "scopedMetadata",
  "turnTransition",
  "summaryCheckpoints",
  "messageDiagnostics",
  "timings",
  "userMetaParsedResult",
  "attachmentBinding",
  "messageDeletion",
  "turnReplacement",
  "deliveries",
  "outboxCursors",
  "outboxMaintenance",
]);

function collectUpdateOwner({ messageUid, owner }, owners) {
  try {
    requirePartitionEntityOwner(owner, Number.MAX_SAFE_INTEGER);
  } catch (cause) {
    if (!(cause instanceof TypeError)) throw cause;
    throw Object.assign(new SessionCommitInputError("Invalid message creation owner"), { cause });
  }
  owners.set(messageUid, owner);
}

function normalizePartitionTimings(timings) {
  try {
    return normalizeTurnTimingRecords(timings);
  } catch (cause) {
    if (
      cause.code !== SESSION_ERROR_CODE.TURN_TIMING_INVALID &&
      cause.code !== SESSION_ERROR_CODE.TURN_TIMING_CONFLICT
    )
      throw cause;
    throw Object.assign(new PartitionAdmissionRejection(cause.code, cause.message), { cause });
  }
}

function hasPartitionOperation(delta, messages, owners) {
  return (
    delta.sessionMetadata ||
    delta.scopedMetadata ||
    delta.artifactEvents?.length ||
    delta.turnTransition ||
    delta.summaryCheckpoints?.length ||
    delta.timings?.length ||
    delta.userMetaParsedResult ||
    delta.attachmentBinding ||
    delta.messageDeletion ||
    delta.turnReplacement ||
    delta.deliveries?.length ||
    delta.outboxCursors?.length ||
    delta.outboxMaintenance ||
    messages.length ||
    owners.size
  );
}

export function requirePartitionMessageChanges(input) {
  if (!isPlainObject(input)) throw new SessionCommitInputError("Invalid session commit input");
  const { changes, committedAt } = input;
  if (
    Object.keys(input).length !== 2 ||
    typeof committedAt !== "string" ||
    !Number.isFinite(Date.parse(committedAt))
  )
    throw new SessionCommitInputError("Invalid session commit input");
  requireSessionChanges(changes);
  const owners = new Map();
  for (const field of updateFields)
    for (const operation of changes[field] ?? []) collectUpdateOwner(operation, owners);
  const delta = { ...changes };
  for (const field of Object.keys(delta))
    if (field !== "messages" && !updateFields.includes(field) && !directChangeFields.has(field))
      throw new PartitionAdmissionRejection(
        "SESSION_CHANGE_UNSUPPORTED",
        `Partition message commit cannot apply ${field}`,
      );
  if (delta.timings) delta.timings = normalizePartitionTimings(delta.timings);
  const messages = delta.messages ?? [];
  if (new Set(messages.map(({ messageUid }) => messageUid)).size !== messages.length)
    throw new PartitionAdmissionRejection(
      "SESSION_MESSAGE_IDENTITY_CONFLICT",
      "Duplicate message creation identity",
    );
  if (!hasPartitionOperation(delta, messages, owners))
    throw new SessionCommitInputError("Partition session commit requires an operation");
  return {
    changes: delta,
    committedAt,
    entities: [...owners].map(([key, owner]) => ({ key, owner })),
  };
}

function projectSuffixCommandResult(outcome, mutations) {
  const suffixField = Object.hasOwn(outcome.result ?? {}, "turnReplacementCommandId")
    ? "turnReplacement"
    : "messageDeletion";
  const commandId = outcome.result?.[`${suffixField}CommandId`];
  if (commandId !== undefined) {
    const receipt = mutations.find(
      ({ collection, key }) => collection === "commands" && key === commandId,
    )?.value;
    const type =
      suffixField === "turnReplacement"
        ? SESSION_COMMAND.TURN_REPLACE
        : SESSION_COMMAND.MESSAGE_DELETE_FROM;
    if (receipt?.type !== type || receipt.commandId !== commandId)
      throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Missing committed suffix receipt");
    return { [suffixField]: { receipt, deduplicated: false } };
  }
  return null;
}

function projectCommandMessageResult(outcome, mutations) {
  const suffixResult = projectSuffixCommandResult(outcome, mutations);
  if (suffixResult) return suffixResult;
  if (outcome.result?.attachmentBindingCommandId !== undefined) {
    const commandId = outcome.result.attachmentBindingCommandId;
    const receipt = mutations.find(
      ({ collection, key }) => collection === "commands" && key === commandId,
    )?.value;
    if (receipt?.type !== SESSION_COMMAND.TURN_ATTACHMENTS_BIND || receipt.commandId !== commandId)
      throw partitionJournalError(
        "SESSION_STORAGE_CORRUPT",
        "Missing committed attachment binding receipt",
      );
    return {
      attachmentBinding: attachmentBindingResult(
        receipt.result.messageUid,
        receipt.aggregateVersion,
        false,
      ),
    };
  }
  if (outcome.result?.userMetaSourceMessageUid !== undefined) {
    const uid = outcome.result.userMetaSourceMessageUid;
    const record = mutations.find(
      ({ collection, key }) => collection === PARTITION_MESSAGE_COLLECTIONS.messages && key === uid,
    );
    const results = record?.value?.message?.userMetaParsedResults;
    if (!Array.isArray(results) || !results.length)
      throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Missing committed user meta result");
    return { userMetaParsedResult: { userMetaParsedResults: results } };
  }
  return null;
}

function collectMessageResultMutations(outcome, mutations) {
  const messageReceipts = [];
  const changedTurns = [];
  let header, commandReceipt;
  const events = new Map();
  const checkpoints = new Map();
  for (const [slot, { collection, key, value }] of mutations.entries()) {
    if (collection === PARTITION_MESSAGE_COLLECTIONS.messages) {
      messageReceipts.push(
        createMessagePersistenceReceipt(
          value.message,
          outcome.generation,
          value.contentVersion,
          outcome.mutations[slot].owner,
        ),
      );
    } else if (collection === "lifecycle") changedTurns.push(value);
    else if (collection === "metadata" && key === "lifecycle") header = value;
    else if (collection === "commands") commandReceipt = value;
    else if (collection === "events") events.set(key, value);
    else if (collection === "checkpoints") checkpoints.set(key, value);
  }
  return { messageReceipts, changedTurns, header, commandReceipt, events, checkpoints };
}

function projectCheckpointResult({ key, turnScopeId, duplicate }, checkpoints) {
  if (duplicate) return { ...duplicate, turnScopeId };
  const receipt = checkpoints.get(key);
  if (!receipt)
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Missing committed checkpoint receipt");
  return {
    committed: true,
    turnScopeId,
    markedCount: receipt.markedCount,
    checkpointRevision: receipt.checkpointRevision,
    receipt,
  };
}

export function projectPartitionMessageResult(outcome, mutations, decodeEvent) {
  const commandResult = projectCommandMessageResult(outcome, mutations);
  if (commandResult) return commandResult;
  const { messageReceipts, changedTurns, header, commandReceipt, events, checkpoints } =
    collectMessageResultMutations(outcome, mutations);
  const result = { messageReceipts };
  if (outcome.result?.eventIds)
    result.events = outcome.result.eventIds.map((eventId) => {
      const event = events.get(eventId);
      if (!event)
        throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Missing committed authority event");
      return decodeEvent(event).envelope;
    });
  if (outcome.result?.deliveries) result.deliveries = outcome.result.deliveries;
  if (outcome.result?.outboxCursors) result.outboxCursors = outcome.result.outboxCursors;
  if (outcome.result?.outboxMaintenance)
    result.outboxMaintenance = outcome.result.outboxMaintenance;
  if (outcome.result?.summaryCheckpoints) {
    result.summaryCheckpoints = outcome.result.summaryCheckpoints.map((checkpoint) =>
      projectCheckpointResult(checkpoint, checkpoints),
    );
  }
  if (outcome.result?.terminalMaterialized === undefined) return result;
  return {
    ...result,
    turnTransition: projectLifecycleResult(
      outcome,
      { header, commandReceipt, changedTurns, events },
      decodeEvent,
    ),
  };
}

function projectLifecycleResult(
  outcome,
  { header, commandReceipt, changedTurns, events },
  decodeEvent,
) {
  const terminalMaterialized = outcome.result?.terminalMaterialized;
  const storedEvent = events.get(commandReceipt?.eventId);
  const event = storedEvent === undefined ? null : decodeEvent(storedEvent);
  const turn = changedTurns.find(({ turnScopeId }) => turnScopeId === commandReceipt?.turnScopeId);
  if (
    !header ||
    !event ||
    !turn ||
    event.eventId !== commandReceipt.eventId ||
    typeof terminalMaterialized !== "boolean" ||
    (terminalMaterialized && !turn.terminalStatus)
  )
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Invalid committed lifecycle result");
  const { eventId, envelope, committedAt } = event;
  return {
    applied: true,
    turn,
    header,
    changedTurns,
    commandReceipt,
    envelope,
    committedEvent: { eventId, envelope, committedAt },
    terminalMaterialization: terminalMaterialized
      ? {
          materialized: true,
          terminalStatus: turn.terminalStatus,
          summaryVersion: turn.summaryVersion,
          messages: [],
        }
      : null,
  };
}

export function requirePartitionMessageRecord(record, { epoch, scope, messageUid, generation }) {
  if (
    !isPlainObject(record) ||
    !isPlainObject(record.message) ||
    Object.hasOwn(record.message, "content") ||
    record.message.messageUid !== messageUid ||
    !matchesSessionScopeIdentity(record.message, scope) ||
    !Number.isSafeInteger(record.sessionOrdinal) ||
    record.sessionOrdinal < 1 ||
    !Number.isSafeInteger(record.turnOrdinal) ||
    record.turnOrdinal < 1 ||
    (record.previousDialogUserUid !== null && !isMessageIdentity(record.previousDialogUserUid)) ||
    !isPublishedPartitionMessageVersion(record.contentVersion, epoch, generation)
  )
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Invalid partition message record");
  requirePartitionContentBoundaries(record);
  return record;
}

export function isPartitionMessagePositionVisible(record, count, indexedUid) {
  return record.sessionOrdinal <= count && indexedUid === record.message.messageUid;
}

export function requirePartitionSessionMessageCount(value) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw partitionJournalError(
      "SESSION_STORAGE_CORRUPT",
      "Invalid partition session message count",
    );
  return value;
}

export async function readPartitionSessionMessageCount(read) {
  const { collection, key } = PARTITION_SESSION_MESSAGE_COUNT;
  return requirePartitionSessionMessageCount(
    (await read({ collection, keys: [key] })).get(key)?.value,
  );
}

export async function readPartitionMessagePositionVisibility(
  read,
  sessionId,
  count,
  { records, conflict = "Session order references a message at the wrong position" },
) {
  requirePartitionSessionMessageCount(count);
  const corrupt = (message) => {
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", message);
  };
  const { sessionOrder } = PARTITION_MESSAGE_COLLECTIONS;
  const keys = records.map((record) => {
    if (
      !record?.message ||
      record.message.sessionId !== sessionId ||
      !isMessageIdentity(record.message.messageUid) ||
      !Number.isSafeInteger(record.sessionOrdinal) ||
      record.sessionOrdinal < 1
    )
      corrupt("Invalid partition message position");
    return record.sessionOrdinal > count
      ? null
      : partitionMessageEntryKey(sessionOrder, sessionId, record.sessionOrdinal);
  });
  const selected = [...new Set(keys.filter((key) => key !== null))];
  const positions = selected.length
    ? await read({ collection: sessionOrder, keys: selected })
    : new Map();
  const reused = [];
  const visibility = records.map((record, index) => {
    const key = keys[index];
    if (key === null) return false;
    const indexedUid = positions.get(key)?.value;
    if (!isMessageIdentity(indexedUid)) corrupt("Missing partition session message order entry");
    if (isPartitionMessagePositionVisible(record, count, indexedUid)) return true;
    reused.push({ indexedUid, ordinal: record.sessionOrdinal });
    return false;
  });
  await requireReusedMessagePositions(read, { reused, sessionId, conflict });
  return visibility;
}

async function requireReusedMessagePositions(read, { reused, sessionId, conflict }) {
  if (!reused.length) return;
  const replacements = await read({
    collection: PARTITION_MESSAGE_COLLECTIONS.messages,
    keys: [...new Set(reused.map(({ indexedUid }) => indexedUid))],
  });
  for (const { indexedUid, ordinal } of reused) {
    const record = replacements.get(indexedUid)?.value;
    if (
      record?.message?.messageUid !== indexedUid ||
      record.message.sessionId !== sessionId ||
      record.sessionOrdinal !== ordinal
    )
      throw partitionJournalError("SESSION_STORAGE_CORRUPT", conflict);
  }
}

export function partitionMessageEntryKey(collection, id, ordinal) {
  if (!isMessageIdentity(id) || !Number.isSafeInteger(ordinal) || ordinal < 1)
    throw new TypeError("Invalid partition message entry identity");
  const key = JSON.stringify([id, ordinal]);
  partitionEntityKey(collection, key);
  return key;
}

export function partitionMessageContentVersion(epoch, generation, slot) {
  return `p:${epoch}:${generation}:${slot}`;
}

export function isPublishedPartitionMessageVersion(value, epoch, generation) {
  if (typeof value !== "string") return false;
  const fields = /^p:([^:]+):([1-9][0-9]*):(0|[1-9][0-9]*)$/.exec(value);
  if (!fields || fields[1] !== epoch || !isPartitionEpoch(epoch)) return false;
  const sequence = Number(fields[2]);
  return (
    Number.isSafeInteger(sequence) &&
    sequence <= generation &&
    Number.isSafeInteger(Number(fields[3]))
  );
}

export const PARTITION_MESSAGE_PAGE = Object.freeze({
  sessionOrder: "sessionOrder",
  suffix: "suffix",
  turn: "turn",
  content: "content",
});

const pageIdentityLengths = new Map([
  [PARTITION_MESSAGE_PAGE.sessionOrder, 0],
  [PARTITION_MESSAGE_PAGE.suffix, 1],
  [PARTITION_MESSAGE_PAGE.turn, 2],
  [PARTITION_MESSAGE_PAGE.content, 4],
]);

export function requirePartitionMessagePage(snapshot, kind, identity, { cursor, limit }) {
  if (
    !Array.isArray(identity) ||
    identity.length !== pageIdentityLengths.get(kind) ||
    identity.some((id) => !isMessageIdentity(id)) ||
    !Number.isSafeInteger(limit) ||
    limit < 1
  )
    throw new TypeError("Invalid message page request");
  requirePartitionCollectionPageLimit(snapshot, limit);
  return requireSessionMessagePagePosition(
    [snapshot.sessionId, snapshot.epoch, snapshot.sequence, kind, ...identity],
    cursor,
  );
}

function messagePage(entries, position, hasMore) {
  return { entries, nextCursor: nextSessionMessagePageCursor(position, entries.length, hasMore) };
}

export function createPartitionMessagePage(snapshot, entries, position, hasMore) {
  const page = messagePage(entries, position, hasMore);
  partitionCollectionResultBytes(page, snapshot.limits.pageBytes);
  return page;
}

export function resolvePartitionMessageSuffix(snapshot, anchor, count) {
  if (anchor.turnOrdinal !== 1)
    throw partitionJournalError(
      "SESSION_STORAGE_CORRUPT",
      "Invalid partition message suffix anchor",
    );
  return resolvePartitionSuffix(snapshot, anchor, count);
}

export function resolvePartitionReplacementSuffix({
  snapshot,
  first,
  candidate,
  indexedMessageUid,
  count,
}) {
  const position = (record) => ({ message: record.message, ordinal: record.sessionOrdinal });
  if (
    !candidate ||
    !matchesTurnReplacementAnchor({
      first: position(first),
      candidate: position(candidate),
      indexedMessageUid,
    })
  )
    throw partitionJournalError(
      "SESSION_STORAGE_CORRUPT",
      "Invalid partition replacement user anchor",
    );
  return resolvePartitionSuffix(snapshot, candidate, count);
}

function resolvePartitionSuffix(snapshot, anchor, count) {
  const { messageUid, sessionId, dialogProcessId, turnScopeId } = anchor.message;
  const suffix = resolveSessionMessageSuffix(anchor.sessionOrdinal, count);
  if (
    sessionId !== snapshot.sessionId ||
    ![sessionId, dialogProcessId, turnScopeId, messageUid].every(isMessageIdentity) ||
    suffix === null
  )
    throw partitionJournalError(
      "SESSION_STORAGE_CORRUPT",
      "Invalid partition message suffix anchor",
    );
  return {
    ...suffix,
    predecessor: { sessionId, epoch: snapshot.epoch, generation: snapshot.sequence },
    anchor: { dialogProcessId, turnScopeId, messageUid },
  };
}

export function createPartitionMessageSuffixPage(snapshot, entries, position, suffix) {
  const effect = resolveSessionMessageSuffixEffect(suffix.messageSuffix);
  const { predecessor, anchor } = suffix;
  if (
    effect === null ||
    !isPlainObject(predecessor) ||
    collectExactFieldErrors(predecessor, ["sessionId", "epoch", "generation"]).length ||
    predecessor.sessionId !== snapshot.sessionId ||
    predecessor.epoch !== snapshot.epoch ||
    predecessor.generation !== snapshot.sequence ||
    !isPlainObject(anchor) ||
    collectExactFieldErrors(anchor, ["dialogProcessId", "turnScopeId", "messageUid"]).length ||
    !Object.values(anchor).every(isMessageIdentity)
  )
    throw partitionJournalError(
      "SESSION_STORAGE_CORRUPT",
      "Invalid partition message suffix source",
    );
  const { messageSuffix, deletedCount } = effect;
  const hasMore = position.after + entries.length < deletedCount;
  const page = { messageSuffix, predecessor, anchor, ...messagePage(entries, position, hasMore) };
  partitionCollectionResultBytes(page, snapshot.limits.pageBytes);
  return page;
}
