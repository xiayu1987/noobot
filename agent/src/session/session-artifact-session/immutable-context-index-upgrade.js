/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ImmutableSessionStore } from "./immutable-session-store.js";
import { ImmutableSessionChanges } from "./immutable-message-changes.js";
import { immutableOrderKey } from "./immutable-order-key.js";
import { immutableStorageError } from "./immutable-object-store.js";
import { isContextSourceMessageCandidate } from "@noobot/context-protocol/assembly/source";
import { IMMUTABLE_CONTEXT_INDEX_VERSION } from "@noobot/session-protocol/immutable-storage-graph";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { updateImmutableContextSource } from "./immutable-context-source-index.js";
import { isDeepStrictEqual } from "node:util";

async function changedIndexEntries(plan, get) {
  const changes = [];
  for (const change of plan.changes()) {
    const previous = await get(change.collection, change.key);
    if (!isDeepStrictEqual(previous, change.remove ? null : change.value)) changes.push(change);
  }
  return changes;
}

async function rebuildTurnContextSources(store, plan, turn) {
  let entries = [];
  for await (const entry of store.index.entries(turn.messagesRoot)) {
    entries.push(entry);
    if (entries.length === QUANTITY_THRESHOLDS.immutableStorage.messagePageSize) {
      await indexContextSourceBatch({ store, plan, turn, entries });
      entries = [];
    }
  }
  if (entries.length) await indexContextSourceBatch({ store, plan, turn, entries });
}

async function indexContextSourceBatch({ store, plan, turn, entries }) {
  const values = await store.objects.readValuesMetadata(entries.map(([, ref]) => ref));
  const candidates = [];
  for (let position = 0; position < values.length; position += 1) {
    const message = values[position].value.message;
    if (
      message.messageUid !== entries[position][0] ||
      message.turnScopeId !== turn.turnScopeId ||
      message.dialogProcessId !== turn.dialogProcessId ||
      message.sessionId !== store.sessionId
    )
      throw immutableStorageError("Context index upgrade message ownership mismatch");
    if (isContextSourceMessageCandidate(message)) candidates.push(entries[position]);
  }
  if (candidates.length)
    await updateImmutableContextSource(store, plan, turn.turnScopeId, candidates);
}

export async function upgradeImmutableContextIndexes({ sessionDir, sessionId }) {
  const store = await ImmutableSessionStore.open({ sessionDir, sessionId });
  const snapshot = await store.snapshot();
  return store.transact({
    expectedGeneration: snapshot.generation,
    operationId: `upgrade-context-indexes:${snapshot.generation}`,
    input: {},
    prepare: async ({ snapshot: pinned, get }) => {
      const facts = await get("metadata", "facts");
      if (!facts) throw immutableStorageError("Missing session facts during index upgrade");
      const plan = new ImmutableSessionChanges(get);
      for (const collection of ["contextSources", "dialogTurns", "dialogOrder"])
        for await (const [key] of store.entries(pinned, collection)) plan.remove(collection, key);
      for await (const [, dialog] of store.entries(pinned, "dialogs")) {
        plan.set("dialogOrder", immutableOrderKey(dialog.dialogOrdinal), dialog.dialogProcessId);
        plan.set("dialogTurns", dialog.dialogProcessId, { count: 0, root: null });
      }
      const turns = [];
      for await (const [, turn] of store.entries(pinned, "turns")) turns.push(turn);
      turns.sort((a, b) => a.turnOrdinal - b.turnOrdinal);
      for (const turn of turns) {
        if (!(await plan.get("dialogs", turn.dialogProcessId)))
          throw immutableStorageError("Turn has no owning dialog during index upgrade");
        const previous = await plan.get("dialogTurns", turn.dialogProcessId);
        const count = previous.count + 1;
        const root = await store.index.set(
          previous.root,
          immutableOrderKey(count),
          await store.objects.putValue(turn.turnScopeId),
        );
        plan.set("dialogTurns", turn.dialogProcessId, { count, root });
        plan.set("contextSources", turn.turnScopeId, { count: 0, root: null });
        await rebuildTurnContextSources(store, plan, turn);
      }
      plan.set("metadata", "facts", {
        ...facts,
        contextIndexVersion: IMMUTABLE_CONTEXT_INDEX_VERSION,
      });
      const changes = await changedIndexEntries(plan, get);
      return { abort: changes.length === 0, changes, result: { upgraded: changes.length > 0 } };
    },
  });
}
