/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ImmutableSessionStore } from "./immutable-session-store.js";
import { immutableOrderKey } from "./immutable-order-key.js";
import { immutableStorageError } from "./immutable-object-store.js";
import {
  IMMUTABLE_COMMIT_INDEX_VERSION,
  IMMUTABLE_COMMIT_ORIGIN_COLLECTIONS,
  createImmutableCommitOrigin,
} from "@noobot/session-protocol/immutable-storage-graph";

function collectMutationOrigins(sources, record, generation) {
  for (const mutation of record.mutations) {
    const entries = sources.get(mutation.collection);
    if (!entries || entries.has(mutation.key)) continue;
    entries.set(mutation.key, {
      reference: mutation.reference,
      origin: createImmutableCommitOrigin(generation),
    });
  }
}

async function prepareCollectionOrigins({ store, root, source, target, entries }) {
  const changes = [];
  const sourceRoot = await store.index.get(root, source);
  for await (const [key, current] of store.index.entries(sourceRoot)) {
    if (entries.get(key)?.reference !== current)
      throw immutableStorageError("Origin history disagrees with current session state");
  }
  for (const [key, { reference, origin }] of entries) {
    if ((await store.index.get(sourceRoot, key)) !== reference)
      throw immutableStorageError("Origin history disagrees with current session state");
    changes.push(
      reference === null
        ? { collection: target, key, remove: true }
        : { collection: target, key, value: origin },
    );
  }
  const originRoot = await store.index.get(root, target);
  for await (const [key] of store.index.entries(originRoot)) {
    if (!entries.has(key)) changes.push({ collection: target, key, remove: true });
  }
  return changes;
}

export async function upgradeImmutableCommitIndex({ sessionDir, sessionId }) {
  const store = await ImmutableSessionStore.open({ sessionDir, sessionId });
  const snapshot = await store.snapshot();
  return store.transact({
    expectedGeneration: snapshot.generation,
    operationId: `upgrade-commit-index:${snapshot.generation}`,
    input: {},
    prepare: async ({ snapshot: pinned, get }) => {
      const header = await get("metadata", "commitIndex");
      if (header?.version === IMMUTABLE_COMMIT_INDEX_VERSION)
        return { abort: true, changes: [], result: { upgraded: false } };
      if (header !== null && ![1, 2, 3].includes(header.version))
        throw immutableStorageError("Unknown session commit index version");
      const changes = [];
      const sources = new Map(
        Object.keys(IMMUTABLE_COMMIT_ORIGIN_COLLECTIONS).map((collection) => [
          collection,
          new Map(),
        ]),
      );
      let reference = pinned.commit;
      for (let generation = pinned.generation; generation >= 1; generation -= 1) {
        const record = await store.readCommitRecord(reference, generation);
        collectMutationOrigins(sources, record, generation);
        changes.push({
          collection: "commitOrder",
          key: immutableOrderKey(generation),
          value: record,
        });
        reference = record.previous;
      }
      for (const [source, target] of Object.entries(IMMUTABLE_COMMIT_ORIGIN_COLLECTIONS)) {
        changes.push(
          ...(await prepareCollectionOrigins({
            store,
            root: pinned.root,
            source,
            target,
            entries: sources.get(source),
          })),
        );
      }
      changes.push({
        collection: "metadata",
        key: "commitIndex",
        value: { version: IMMUTABLE_COMMIT_INDEX_VERSION },
      });
      return { changes, result: { upgraded: true } };
    },
  });
}
