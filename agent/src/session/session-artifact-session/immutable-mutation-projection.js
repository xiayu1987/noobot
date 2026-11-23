/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  requireSessionMutationProjection,
  resolveSessionMessageSuffix,
  SESSION_ERROR_CODE,
} from "@noobot/session-protocol";
import { immutableStorageError } from "./immutable-object-store.js";
import { readImmutableCommandChanges } from "./immutable-command-index.js";
import { immutableOrderKey } from "./immutable-order-key.js";

function requirePublishedValue(changes, key) {
  const change = changes.find((entry) => entry.collection === "metadata" && entry.key === key);
  if (!change || change.remove || !change.value)
    throw immutableStorageError(`Mutation commit has no published ${key}`);
  return change.value;
}

function entityChanges(changes, collection) {
  return changes
    .filter((entry) => entry.collection === collection)
    .map((entry) => ({ key: entry.key, value: entry.remove ? null : entry.value }));
}

function requireProjection(projection, sessionId) {
  try {
    return requireSessionMutationProjection(projection, { sessionId });
  } catch (error) {
    if (error.code !== SESSION_ERROR_CODE.SESSION_MUTATION_PROJECTION_INVALID) throw error;
    throw Object.assign(immutableStorageError(error.message), { cause: error });
  }
}

function readMessageSuffix(changes, messages, deletedCount) {
  const { messageCount, messageSequence } = requirePublishedValue(changes, "facts");
  if (!Number.isSafeInteger(messageCount) || messageCount !== messageSequence)
    throw immutableStorageError("Mutation commit has an invalid published message count");
  const inserted = new Map(messages.map(({ ordinal, message }) => [ordinal, message.messageUid]));
  let firstOrdinal = Infinity;
  let lastOrdinal = 0;
  let positions = 0;
  for (const change of changes) {
    if (change.collection !== "messageOrder") continue;
    const ordinal = Number(change.key);
    const insertedUid = inserted.get(ordinal);
    if (
      immutableOrderKey(ordinal) !== change.key ||
      (insertedUid === undefined ? !change.remove : change.remove || change.value !== insertedUid)
    )
      throw immutableStorageError("Mutation commit disagrees with its published message order");
    firstOrdinal = Math.min(firstOrdinal, ordinal);
    lastOrdinal = Math.max(lastOrdinal, ordinal);
    positions += 1;
  }
  const suffix = resolveSessionMessageSuffix(firstOrdinal, lastOrdinal);
  if (
    suffix === null ||
    positions !== deletedCount ||
    positions !== suffix.deletedCount ||
    messageCount !== suffix.retainedMessageCount + messages.length
  )
    throw immutableStorageError("Mutation commit has an incomplete published message suffix");
  return suffix.messageSuffix;
}

export async function readImmutableMutationProjection({ store, snapshot, commandId }) {
  const source = await readImmutableCommandChanges({ store, snapshot, commandId });
  if (source === null) return null;
  const { receipt, generation, kind } = source;
  if (kind === "baseline") return requireProjection({ kind, generation, receipt }, store.sessionId);

  const metadata = requirePublishedValue(source.changes, "session");
  const lifecycleHead = requirePublishedValue(source.changes, "lifecycle");
  let deletedCount = 0;
  const messages = [];
  for (const change of source.changes) {
    if (change.collection !== "messages") continue;
    if (change.remove) {
      deletedCount += 1;
      continue;
    }
    if (change.value?.message?.messageUid !== change.key)
      throw immutableStorageError("Mutation message key disagrees with its published identity");
    messages.push(change.value);
  }
  const messageSuffix = readMessageSuffix(source.changes, messages, deletedCount);
  return requireProjection(
    {
      kind,
      generation,
      receipt,
      baseAggregateVersion: receipt.aggregateVersion - 1,
      metadata,
      lifecycleHead,
      messageSuffix,
      messages,
      turns: entityChanges(source.changes, "lifecycle"),
      replacements: entityChanges(source.changes, "replacements"),
      timings: entityChanges(source.changes, "timings"),
    },
    store.sessionId,
  );
}
