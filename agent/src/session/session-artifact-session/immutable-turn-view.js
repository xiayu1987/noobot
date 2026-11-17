/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { requireSessionTurnViewSelection } from "@noobot/session-protocol";
import { readImmutableMessage, readImmutableTurnPage } from "./immutable-message-reader.js";
import { readImmutableCheckpointState } from "./immutable-checkpoint-reader.js";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";

async function collectTurnRecords(store, snapshot, turnScopeId, records) {
  let after = 0;
  let page;
  do {
    page = await readImmutableTurnPage({
      store,
      snapshot,
      turnScopeId,
      after,
      limit: QUANTITY_THRESHOLDS.immutableStorage.messagePageSize,
    });
    if (page === null) return;
    for (const record of page.records) records.set(record.message.messageUid, record);
    after = page.cursor;
  } while (page.hasMore);
}

async function collectDialog(store, snapshot, partition, dialogs) {
  if (!partition || dialogs.has(partition.dialogProcessId)) return;
  const dialog = await store.get(snapshot, "dialogs", partition.dialogProcessId);
  if (dialog) dialogs.set(partition.dialogProcessId, dialog);
}

export async function readImmutableTurnView({ store, snapshot, turnScopeIds, messageUids }) {
  const selection = requireSessionTurnViewSelection({ turnScopeIds, messageUids });
  const metadata = await store.get(snapshot, "metadata", "session");
  const header = await store.get(snapshot, "metadata", "lifecycle");
  const records = new Map();
  const scopes = new Set(selection.turnScopeIds);
  for (const turnScopeId of selection.turnScopeIds)
    await collectTurnRecords(store, snapshot, turnScopeId, records);
  for (const uid of selection.messageUids) {
    if (records.has(uid)) continue;
    const record = await readImmutableMessage(store, snapshot, uid);
    if (record) {
      records.set(uid, record);
      scopes.add(record.message.turnScopeId);
    }
  }
  const turns = {};
  const dialogs = new Map();
  const timings = [];
  const checkpoints = {};
  for (const scope of scopes) {
    const turn = await store.get(snapshot, "lifecycle", scope);
    if (turn) Object.defineProperty(turns, scope, { value: turn, enumerable: true });
    const descriptor = await store.get(snapshot, "turns", scope);
    await collectDialog(store, snapshot, descriptor === null ? turn : descriptor, dialogs);
    const timing = await store.get(snapshot, "timings", scope);
    if (timing) timings.push(timing);
    const checkpoint = await readImmutableCheckpointState(store, snapshot, scope);
    if (checkpoint)
      Object.defineProperty(checkpoints, scope, { value: checkpoint, enumerable: true });
  }
  return {
    generation: snapshot.generation,
    turnScopeIds: [...scopes],
    session: {
      ...metadata,
      messages: [...records.values()]
        .sort((a, b) => a.ordinal - b.ordinal)
        .map(({ message }) => message),
      dialogOrder: [...dialogs.values()].sort((a, b) => a.dialogOrdinal - b.dialogOrdinal),
      turnTimings: timings,
      turnLifecycle: { ...header, turns, replacedTurns: {}, commandReceipts: [] },
      sessionArtifactEvents: [],
      ...(Object.keys(checkpoints).length ? { turnSummaryCheckpoints: checkpoints } : {}),
    },
  };
}
