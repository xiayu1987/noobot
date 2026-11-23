/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, isPlainObject } from "@noobot/shared/value";
import { requireAuthorityEventSequenceFloor } from "@noobot/event-protocol/outbox";
import { readSessionEventSequenceFloor, requireTurnLifecycleHeader } from "./turn-lifecycle.js";
import { isCanonicalCommandReceipt } from "./command/command-receipt.js";
import { partitionJournalError } from "./partition-journal.js";
import { PARTITION_LIFECYCLE_HEADER, requirePartitionOutboxTail } from "./partition-transaction.js";
import { requirePartitionMessageTurnOwnership } from "./partition-session-messages.js";
import { readPartitionTurnMembershipVisibility } from "./partition-turn-visibility.js";
import { projectSessionTurnDescriptor } from "./session-reader.js";
import { requirePartitionContextDescriptor } from "./partition-context-index.js";
import {
  createScopedSessionMetadataRecord,
  readScopedSessionMetadataRecord,
} from "./aggregate/scoped-session-metadata.js";

export const PARTITION_SCOPED_METADATA = Object.freeze({ collection: "metadata", key: "scoped" });

export function requirePartitionScopedMetadata(record) {
  try {
    return readScopedSessionMetadataRecord(record);
  } catch (cause) {
    if (!(cause instanceof TypeError)) throw cause;
    throw Object.assign(partitionJournalError("SESSION_STORAGE_CORRUPT", cause.message), { cause });
  }
}

export async function readPartitionScopedMetadata(read) {
  const { collection, key } = PARTITION_SCOPED_METADATA;
  return requirePartitionScopedMetadata((await read({ collection, keys: [key] })).get(key)?.value);
}

export async function preparePartitionScopedMetadata(view, mutations, value) {
  const { collection, key } = PARTITION_SCOPED_METADATA;
  const current = (await view.getLatestMany({ collection, keys: [key] })).get(key);
  requirePartitionScopedMetadata(current?.mutation.remove ? undefined : current?.mutation.value);
  mutations.push({
    collection,
    key,
    owner: current.owner,
    value: createScopedSessionMetadataRecord(value),
  });
}

export const PARTITION_DIALOG_SEQUENCE = Object.freeze({
  collection: "metadata",
  key: "dialogSequence",
});

export function requirePartitionDialogSequence(value) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Invalid dialog sequence");
  return value;
}

export function requirePartitionDialog(dialog, dialogProcessId) {
  if (
    !isPlainObject(dialog) ||
    dialog.dialogProcessId !== dialogProcessId ||
    !isCanonicalText(dialogProcessId) ||
    !isCanonicalText(dialog.turnScopeId) ||
    !Number.isSafeInteger(dialog.dialogOrdinal) ||
    dialog.dialogOrdinal < 1 ||
    !Number.isSafeInteger(dialog.messageCount) ||
    dialog.messageCount < 1 ||
    !Number.isSafeInteger(dialog.turnCount) ||
    dialog.turnCount < 1 ||
    dialog.turnCount > dialog.messageCount ||
    (dialog.userMessageUid !== "" && !isCanonicalText(dialog.userMessageUid)) ||
    (dialog.latestUserMessageUid !== null && !isCanonicalText(dialog.latestUserMessageUid))
  )
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Invalid partition dialog");
  const candidates = requirePartitionContextDescriptor(dialog.contextCandidates);
  if (candidates.count > dialog.messageCount)
    throw partitionJournalError(
      "SESSION_STORAGE_CORRUPT",
      "Dialog context count exceeds membership",
    );
  return dialog;
}

export async function readPartitionDialog(read, dialogProcessId) {
  if (!isCanonicalText(dialogProcessId)) throw new TypeError("Dialog read requires a canonical ID");
  const stored = (await read({ collection: "dialogs", keys: [dialogProcessId] })).get(
    dialogProcessId,
  );
  if (stored === null) return null;
  const { turnScopeId, dialogOrdinal, userMessageUid } = requirePartitionDialog(
    stored.value,
    dialogProcessId,
  );
  return { dialogProcessId, turnScopeId, dialogOrdinal, userMessageUid };
}

export function requirePartitionEventSequenceFloor(value) {
  try {
    return requireAuthorityEventSequenceFloor(value);
  } catch (cause) {
    if (!(cause instanceof TypeError)) throw cause;
    throw Object.assign(partitionJournalError("SESSION_STORAGE_CORRUPT", cause.message), { cause });
  }
}

export function readPartitionEventSequence(read, identity) {
  return readSessionEventSequenceFloor({
    ...identity,
    readLifecycleHead: () => readPartitionLifecycleHeader(read),
    readStoredFloor: (key) => readPartitionStoredEventSequenceFloor(read, key),
  });
}

export async function readPartitionStoredEventSequenceFloor(read, key) {
  const stored = (await read({ collection: "eventSequences", keys: [key] })).get(key);
  return stored === null ? null : requirePartitionEventSequenceFloor(stored.value);
}

export function requirePartitionLifecycleHeader(header) {
  try {
    requireTurnLifecycleHeader(header);
  } catch (cause) {
    if (cause.code !== "TURN_LIFECYCLE_RECORD_INVALID") throw cause;
    throw Object.assign(partitionJournalError("SESSION_STORAGE_CORRUPT", cause.message), { cause });
  }
  requirePartitionOutboxTail(header);
  return header;
}

export async function readPartitionLifecycleHeader(read) {
  const { collection, key } = PARTITION_LIFECYCLE_HEADER;
  return requirePartitionLifecycleHeader((await read({ collection, keys: [key] })).get(key)?.value);
}

export async function readPartitionTurnState(read, turnScopeId, header, checkMessage) {
  const states = await readPartitionTurnStates(read, [turnScopeId], header, checkMessage);
  return states.get(turnScopeId) ?? null;
}

export async function readPartitionTurnStates(read, turnScopeIds, header, checkMessage) {
  return (await readPartitionTurnMembershipAndStates(read, turnScopeIds, header, checkMessage))
    .states;
}

export async function readPartitionTurnMembershipAndStates(
  read,
  turnScopeIds,
  header,
  checkMessage,
) {
  if (!turnScopeIds.every(isCanonicalText))
    throw new TypeError("Turn state requires a canonical scope ID");
  const { turns, lifecycle } = await requirePartitionMessageTurnOwnership(
    read,
    turnScopeIds.map((turnScopeId) => ({ turnScopeId })),
  );
  const candidates = new Map();
  for (const [key, entry] of lifecycle) {
    if (entry === null) continue;
    if (entry.sequence > header.sequence)
      throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Turn state exceeds lifecycle head");
    candidates.set(key, turns.get(key));
  }
  const visibility = await readPartitionTurnMembershipVisibility(read, candidates, checkMessage);
  const states = new Map(
    [...visibility].filter(([, visible]) => visible).map(([key]) => [key, lifecycle.get(key)]),
  );
  return { turns, states };
}

export async function readPartitionTurnDescriptor(read, turnScopeId, checkMessage) {
  if (!isCanonicalText(turnScopeId))
    throw new TypeError("Turn descriptor requires a canonical scope ID");
  const { turns } = await requirePartitionMessageTurnOwnership(read, [{ turnScopeId }]);
  const membership = turns.get(turnScopeId)?.mutation;
  if (!membership || membership.remove) return null;
  const visibility = await readPartitionTurnMembershipVisibility(read, turns, checkMessage);
  return visibility.get(turnScopeId)
    ? projectSessionTurnDescriptor(turnScopeId, membership.value)
    : null;
}

export function requirePartitionCommandReceipt(receipt, commandId) {
  if (!isCanonicalText(commandId)) throw new TypeError("Command read requires a canonical ID");
  if (!isCanonicalCommandReceipt(receipt) || receipt.commandId !== commandId)
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Invalid partition command receipt");
  return receipt;
}

export async function readPartitionCommandReceipt(read, commandId) {
  if (!isCanonicalText(commandId)) throw new TypeError("Command read requires a canonical ID");
  const stored = (await read({ collection: "commands", keys: [commandId] })).get(commandId);
  return stored === null ? null : requirePartitionCommandReceipt(stored.value, commandId);
}
