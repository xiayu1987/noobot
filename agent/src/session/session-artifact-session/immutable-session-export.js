/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeSessionEntity } from "../entities/session-entity.js";
import { immutableStorageError } from "./immutable-object-store.js";
import { readImmutableSessionSource } from "./immutable-session-source.js";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";

async function readCheckpoints(store, snapshot) {
  const byScope = new Map();
  for await (const [key, receipt] of store.entries(snapshot, "checkpoints")) {
    const [scope, checkpointId] = JSON.parse(key);
    if (checkpointId !== receipt.checkpointId)
      throw immutableStorageError("Checkpoint receipt index identity mismatch");
    if (!byScope.has(scope)) byScope.set(scope, []);
    byScope.get(scope).push(receipt);
  }
  const states = {};
  for await (const [scope, state] of store.entries(snapshot, "checkpointHeads")) {
    const receipts = byScope.get(scope) ?? [];
    byScope.delete(scope);
    receipts.sort((a, b) => a.checkpointRevision - b.checkpointRevision);

    const recent = receipts.slice(
      -QUANTITY_THRESHOLDS.contextProtocol.turnSummaryCheckpointReceiptLimit,
    );
    Object.defineProperty(states, scope, {
      value: { ...state, receipts: recent },
      enumerable: true,
    });
  }
  if (byScope.size) throw immutableStorageError("Checkpoint receipt has no owning state");
  return states;
}

export async function exportImmutableSession({ store, snapshot }) {
  const result = await readImmutableSessionSource({ store, snapshot });
  const checkpoints = await readCheckpoints(store, snapshot);
  if (Object.keys(checkpoints).length) result.turnSummaryCheckpoints = checkpoints;
  return normalizeSessionEntity(result);
}
