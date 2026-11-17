/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { assertTurnSummaryCheckpointState } from "@noobot/context-protocol/policy/summary";
import { ImmutableSessionStore } from "./immutable-session-store.js";
import { ImmutableSessionChanges } from "./immutable-message-changes.js";
import { immutableOrderKey } from "./immutable-order-key.js";
import { immutableStorageError } from "./immutable-object-store.js";
import { immutableCheckpointKey, indexImmutableCheckpoint } from "./immutable-checkpoint-index.js";

function receiptScope(key, receipt) {
  const identity = JSON.parse(key);
  if (
    !Array.isArray(identity) ||
    identity.length !== 2 ||
    identity.some((part) => typeof part !== "string" || !part || part.trim() !== part) ||
    key !== immutableCheckpointKey(...identity) ||
    identity[1] !== receipt.checkpointId
  )
    throw immutableStorageError("Checkpoint upgrade found an invalid receipt identity");
  return identity[0];
}

async function validateCheckpointOrder(store, pinned, get) {
  for await (const [key, id] of store.entries(pinned, "checkpointOrder")) {
    const identity = JSON.parse(key);
    if (
      !Array.isArray(identity) ||
      identity.length !== 2 ||
      typeof identity[0] !== "string" ||
      !identity[0] ||
      typeof id !== "string" ||
      !id
    )
      throw immutableStorageError("Checkpoint upgrade found an invalid order identity");
    const receipt = await get("checkpoints", immutableCheckpointKey(identity[0], id));
    if (
      !receipt ||
      key !== immutableCheckpointKey(identity[0], immutableOrderKey(receipt.checkpointRevision))
    )
      throw immutableStorageError("Checkpoint upgrade found an orphan order entry");
  }
}

export async function upgradeImmutableCheckpointIndexes({ sessionDir, sessionId }) {
  const store = await ImmutableSessionStore.open({ sessionDir, sessionId });
  const snapshot = await store.snapshot();
  return store.transact({
    expectedGeneration: snapshot.generation,
    operationId: `upgrade-checkpoint-indexes:${snapshot.generation}`,
    input: {},
    prepare: async ({ snapshot: pinned, get }) => {
      const version = await get("metadata", "checkpointIndex");
      if (version?.version === 1) return { abort: true, changes: [], result: { upgraded: false } };
      if (version !== null || !(await get("metadata", "session")))
        throw immutableStorageError("Invalid checkpoint index version during upgrade");
      const plan = new ImmutableSessionChanges(get);
      for (const collection of ["turnCheckpoints", "messageCheckpoints"])
        for await (const [key] of store.entries(pinned, collection)) plan.remove(collection, key);
      for await (const [scope, header] of store.entries(pinned, "checkpointHeads"))
        assertTurnSummaryCheckpointState({ ...header, receipts: [] }, scope);
      for await (const [key, receipt] of store.entries(pinned, "checkpoints")) {
        const scope = receiptScope(key, receipt);
        const orderKey = immutableCheckpointKey(
          scope,
          immutableOrderKey(receipt.checkpointRevision),
        );
        if ((await get("checkpointOrder", orderKey)) !== receipt.checkpointId)
          throw immutableStorageError("Checkpoint upgrade found a missing order entry");
        await indexImmutableCheckpoint(store, plan, scope, receipt);
      }
      await validateCheckpointOrder(store, pinned, get);
      plan.set("metadata", "checkpointIndex", { version: 1 });
      return { changes: plan.changes(), result: { upgraded: true } };
    },
  });
}
