/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { requireImmutableListFacts } from "@noobot/session-protocol/immutable-storage-graph";
import { buildMessageSummary } from "../session-summary-builders/message-summary-projection.js";
import { immutableStorageError } from "./immutable-object-store.js";
import { ImmutableSessionStore } from "./immutable-session-store.js";
import { ImmutableSessionChanges } from "./immutable-message-changes.js";

export async function readImmutableListProjection(get) {
  const facts = requireImmutableListFacts(await get("metadata", "facts"));
  if (facts.messageCount === 0) return { messageCount: 0, lastMessage: null };
  const record = await get("messages", facts.lastMessageUid);
  if (record?.message?.messageUid !== facts.lastMessageUid)
    throw immutableStorageError("List facts reference a missing last message");
  return { messageCount: facts.messageCount, lastMessage: buildMessageSummary(record.message) };
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
      await readImmutableListProjection(get);
      const plan = new ImmutableSessionChanges(get);
      plan.remove("metadata", "listProjection");
      return { changes: plan.changes(), result: { upgraded: true } };
    },
  });
}
