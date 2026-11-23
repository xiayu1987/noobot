/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { requireImmutableListFacts } from "@noobot/session-protocol/immutable-storage-graph";
import { immutableListProjectionSource } from "./immutable-message-preview.js";
import { immutableStorageError } from "./immutable-object-store.js";
import { ImmutableSessionStore } from "./immutable-session-store.js";
import { ImmutableSessionChanges } from "./immutable-message-changes.js";

export async function readImmutableListProjection({ get, readMessageSummary }) {
  const facts = requireImmutableListFacts(await get("metadata", "facts"));
  if (facts.messageCount === 0) return { messageCount: 0, lastMessage: null };
  const lastMessage = await readMessageSummary(facts.lastMessageUid);
  if (lastMessage?.messageUid !== facts.lastMessageUid)
    throw immutableStorageError("List facts reference a missing last message");
  return { messageCount: facts.messageCount, lastMessage };
}

export async function upgradeImmutableListProjection({ sessionDir, sessionId }) {
  const store = await ImmutableSessionStore.open({ sessionDir, sessionId });
  const snapshot = await store.snapshot();
  const obsolete = await store.objects.withSnapshot(snapshot, async () => {
    const metadataRoot = await store.index.get(snapshot.root, "metadata");
    return store.index.get(metadataRoot, "listProjection");
  });
  if (obsolete === null) {
    return { generation: snapshot.generation, replayed: true };
  }
  return store.transact({
    expectedGeneration: snapshot.generation,
    operationId: "remove-immutable-list-projection-v1",
    input: {},
    prepare: async ({ get }) => {
      await readImmutableListProjection({ ...immutableListProjectionSource(store, snapshot), get });
      const plan = new ImmutableSessionChanges(get);
      plan.remove("metadata", "listProjection");
      return { changes: plan.changes(), result: { upgraded: true } };
    },
  });
}
