/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { requireSessionMutationProjection, SESSION_ERROR_CODE } from "@noobot/session-protocol";
import { immutableStorageError } from "./immutable-object-store.js";
import { readImmutableCommandChanges } from "./immutable-command-index.js";

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

export async function readImmutableMutationProjection({ store, snapshot, commandId }) {
  const source = await readImmutableCommandChanges({ store, snapshot, commandId });
  if (source === null) return null;
  const { receipt, generation, kind } = source;
  if (kind === "baseline") return requireProjection({ kind, generation, receipt }, store.sessionId);

  const metadata = requirePublishedValue(source.changes, "session");
  const lifecycleHead = requirePublishedValue(source.changes, "lifecycle");
  const deletedMessageUids = [];
  const messages = [];
  for (const change of source.changes) {
    if (change.collection !== "messages") continue;
    if (change.remove) {
      deletedMessageUids.push(change.key);
      continue;
    }
    if (change.value?.message?.messageUid !== change.key)
      throw immutableStorageError("Mutation message key disagrees with its published identity");
    messages.push(change.value);
  }
  return requireProjection(
    {
      kind,
      generation,
      receipt,
      baseAggregateVersion: receipt.aggregateVersion - 1,
      metadata,
      lifecycleHead,
      deletedMessageUids,
      messages,
      turns: entityChanges(source.changes, "lifecycle"),
      replacements: entityChanges(source.changes, "replacements"),
      timings: entityChanges(source.changes, "timings"),
    },
    store.sessionId,
  );
}
