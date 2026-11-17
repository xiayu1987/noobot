/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  immutableValueContentPaths,
  immutableInlineValueParts,
  IMMUTABLE_MESSAGE_FIELDS_UPGRADE_BATCH,
  IMMUTABLE_MESSAGE_DISPLAY_VERSION,
} from "@noobot/session-protocol/immutable-storage-graph";
import { assertSessionMessageMetadata } from "@noobot/session-protocol";
import { immutableStorageError } from "./immutable-object-store.js";
import { ImmutableSessionStore } from "./immutable-session-store.js";
import { ImmutableSessionChanges, publishMessageIndexes } from "./immutable-message-changes.js";

async function publishBatch(store, generation, batch) {
  return store.transact({
    expectedGeneration: generation,
    operationId: `upgrade-message-fields:${generation}`,
    input: { messageUids: batch.map(([uid]) => uid) },
    prepare: async ({ get, getMetadata }) => {
      const plan = new ImmutableSessionChanges(get, { getMetadata });
      for (const [uid, { value, parts }] of batch) plan.set("messages", uid, value, parts);
      await publishMessageIndexes(store, plan);
      return { changes: plan.changes(), result: { count: batch.length } };
    },
  });
}

async function needsInlineLayout({ store, snapshot, root, uid, metadata }) {
  if (!metadata.parts.length || !immutableInlineValueParts(metadata.value, metadata.parts))
    return false;
  return store.objects.withSnapshot(snapshot, async () => {
    const reference = await store.index.get(root, uid);
    return (await store.objects.readPage(reference)).kind === "value-parts";
  });
}

export async function upgradeImmutableMessageFields({ sessionDir, sessionId }) {
  const store = await ImmutableSessionStore.open({ sessionDir, sessionId });
  const snapshot = await store.snapshot();
  const paths = immutableValueContentPaths("messages");
  const root = await store.objects.withSnapshot(snapshot, () =>
    store.index.get(snapshot.root, "messages"),
  );
  let generation = snapshot.generation;
  let batch = [];
  let bytes = 0;
  let count = 0;
  async function flush() {
    if (!batch.length) return;
    const committed = await publishBatch(store, generation, batch);
    generation = committed.generation;
    count += batch.length;
    batch = [];
    bytes = 0;
  }
  for await (const [uid, metadata] of store.entries(snapshot, "messages", { metadata: true })) {
    const { value, parts } = metadata;
    assertSessionMessageMetadata(metadata);
    if (value.message.messageUid !== uid || value.message.sessionId !== store.sessionId)
      throw immutableStorageError("Message field upgrade ownership mismatch");
    if (
      value.display?.version === IMMUTABLE_MESSAGE_DISPLAY_VERSION &&
      !paths.some(
        (path) =>
          Object.hasOwn(value.message, path[1]) && !parts.some((part) => part.path[1] === path[1]),
      ) &&
      !(await needsInlineLayout({ store, snapshot, root, uid, metadata }))
    )
      continue;
    const size = Buffer.byteLength(JSON.stringify(value));
    if (
      batch.length &&
      (batch.length === IMMUTABLE_MESSAGE_FIELDS_UPGRADE_BATCH.records ||
        bytes + size > IMMUTABLE_MESSAGE_FIELDS_UPGRADE_BATCH.bytes)
    )
      await flush();
    batch.push([uid, metadata]);
    bytes += size;
  }
  await flush();
  return { generation, result: { upgraded: count > 0, count } };
}
