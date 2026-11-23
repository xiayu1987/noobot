/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isMessageIdentity } from "./identity/message-identity.js";
import { isCanonicalText, isPlainObject } from "@noobot/shared/value";
import { isCanonicalCommandReceipt } from "./command/command-receipt.js";
import { SESSION_COMMAND } from "./command/session-command.js";
import {
  collectTurnReplacementTombstoneErrors,
  projectTurnReplacementTombstone,
} from "./lifecycle/turn-replacement.js";
import { PartitionAdmissionRejection, partitionJournalError } from "./partition-journal.js";
import { SESSION_ERROR_CODE } from "./errors.js";
import {
  PARTITION_MESSAGE_COLLECTIONS,
  partitionMessageEntryKey,
  readPartitionMessagePositionVisibility,
  readPartitionSessionMessageCount,
  requirePartitionMessageTurnOwnership,
} from "./partition-session-messages.js";

export function createPartitionReplacementReference({ commandId, sequence }) {
  return { commandId, sequence };
}

export async function readPartitionReplacement(
  read,
  { sessionId, turnScopeId, lifecycleSequence },
) {
  const reference = await read("replacements", turnScopeId);
  if (reference === null) return null;
  const corrupt = () =>
    partitionJournalError("SESSION_STORAGE_CORRUPT", "Invalid partition replacement reference");
  if (
    !isPlainObject(reference) ||
    Object.keys(reference).length !== 2 ||
    !isCanonicalText(reference.commandId) ||
    !Number.isSafeInteger(reference.sequence) ||
    reference.sequence < 1 ||
    reference.sequence > lifecycleSequence
  )
    throw corrupt();
  const receipt = await read("commands", reference.commandId);
  if (
    !isCanonicalCommandReceipt(receipt) ||
    receipt.type !== SESSION_COMMAND.TURN_REPLACE ||
    receipt.commandId !== reference.commandId
  )
    throw corrupt();
  const replacement = receipt.result.turnReplacement;
  if (
    replacement.sessionId !== sessionId ||
    replacement.commandId !== receipt.commandId ||
    replacement.requestHash !== receipt.requestHash ||
    replacement.committedAt !== receipt.committedAt ||
    replacement.committedAggregateVersion !== receipt.aggregateVersion
  )
    throw corrupt();
  const tombstone = projectTurnReplacementTombstone(replacement, {
    turnScopeId,
    sequence: reference.sequence,
  });
  if (collectTurnReplacementTombstoneErrors(tombstone, lifecycleSequence).length) throw corrupt();
  return tombstone;
}

export async function readPartitionLifecycleTurn(read, turnScopeId, checkMessage) {
  const stored = (
    await read({
      collection: "lifecycle",
      keys: [turnScopeId],
      includeOwner: true,
    })
  ).get(turnScopeId);
  if (stored?.mutation.remove)
    throw new PartitionAdmissionRejection(
      SESSION_ERROR_CODE.TURN_IDENTITY_CONFLICT,
      "Lifecycle references a retired turn",
    );
  const { turns, lifecycle } = await requirePartitionMessageTurnOwnership(read, [{ turnScopeId }]);
  const visibility = await readPartitionTurnMembershipVisibility(read, turns, checkMessage);
  if (!visibility.get(turnScopeId))
    throw new PartitionAdmissionRejection(
      SESSION_ERROR_CODE.TURN_IDENTITY_CONFLICT,
      "Lifecycle references a hidden turn",
    );
  return lifecycle.get(turnScopeId);
}

export async function readPartitionEventTurnVisibility(read, turnScopeIds, checkMessage) {
  const { turns, lifecycle, retiredLifecycle } = await requirePartitionMessageTurnOwnership(
    read,
    turnScopeIds.map((turnScopeId) => ({ turnScopeId })),
  );
  const visibility = await readPartitionTurnMembershipVisibility(read, turns, checkMessage);
  for (const [key, member] of turns) {
    const exists = member !== null || lifecycle.get(key) !== null;
    if (!exists || retiredLifecycle.has(key)) visibility.set(key, false);
  }
  return visibility;
}

export async function readPartitionTurnMembershipVisibility(read, turns, checkMessage) {
  const visibility = new Map();
  const members = [];
  for (const [turnScopeId, entry] of turns) {
    const membership = entry?.mutation;
    visibility.set(turnScopeId, !membership?.remove);
    if (membership && !membership.remove) members.push([turnScopeId, membership.value]);
  }
  if (!members.length) return visibility;
  const { order, messages } = PARTITION_MESSAGE_COLLECTIONS;
  const keys = members.map(([turnScopeId]) => partitionMessageEntryKey(order, turnScopeId, 1));
  const positions = await read({ collection: order, keys });
  const uids = keys.map((key) => {
    const uid = positions.get(key)?.value;
    if (!isMessageIdentity(uid))
      throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Missing partition turn anchor");
    return uid;
  });
  const stored = await read({ collection: messages, keys: [...new Set(uids)] });
  const anchors = members.map(([turnScopeId, membership], index) => {
    const anchor = checkMessage(stored.get(uids[index])?.value, uids[index]);
    if (
      anchor.turnOrdinal !== 1 ||
      anchor.message.turnScopeId !== turnScopeId ||
      anchor.message.dialogProcessId !== membership.dialogProcessId
    )
      throw partitionJournalError(
        "SESSION_STORAGE_CORRUPT",
        "Partition turn anchor ownership disagrees",
      );
    return anchor;
  });
  const count = await readPartitionSessionMessageCount(read);
  const visible = await readPartitionMessagePositionVisibility(
    read,
    anchors[0].message.sessionId,
    count,
    { records: anchors },
  );
  for (const [index, [turnScopeId]] of members.entries())
    visibility.set(turnScopeId, visible[index]);
  return visibility;
}
