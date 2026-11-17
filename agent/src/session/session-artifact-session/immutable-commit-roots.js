/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { immutableOrderKey } from "./immutable-order-key.js";
import {
  createImmutableCommitOrigin,
  IMMUTABLE_COMMIT_INDEX_TARGET_BYTES,
  IMMUTABLE_COMMIT_ORIGIN_COLLECTIONS,
} from "@noobot/session-protocol/immutable-storage-graph";
import { ImmutableRadixIndex } from "./immutable-radix-index.js";
import { runStorageBatch } from "./storage-batch-results.js";

export const immutableCommitIndex = Object.freeze({
  origins: IMMUTABLE_COMMIT_ORIGIN_COLLECTIONS,
  readReference: (store, snapshot, generation) => store.readCommitReference(snapshot, generation),
  indexCommit: indexImmutableCommit,
});

async function prepareCollectionRoots({
  index,
  objects,
  previousRoot,
  generation,
  mutations,
  collectionRoots = new Map(),
  origins = IMMUTABLE_COMMIT_ORIGIN_COLLECTIONS,
}) {
  const grouped = new Map();
  for (const { collection, key, reference } of mutations) {
    if (!grouped.has(collection)) grouped.set(collection, []);
    grouped.get(collection).push([key, reference]);
  }
  const affectedOrigins = Object.entries(origins).filter(([source]) => grouped.has(source));
  const collections = new Set([...grouped.keys(), ...affectedOrigins.map(([, target]) => target)]);
  const missing = [...collections].filter((collection) => !collectionRoots.has(collection));
  const resolved = await index.getMany(previousRoot, missing);
  const previousCollectionRoot = (collection) =>
    collectionRoots.has(collection) ? collectionRoots.get(collection) : resolved.get(collection);
  const updates = [...grouped];
  let originReference;
  for (const [source, target] of affectedOrigins) {
    const changes = [];
    for (const [key, reference] of grouped.get(source)) {
      if (reference !== null && originReference === undefined)
        originReference = await objects.putValue(createImmutableCommitOrigin(generation));
      changes.push([key, reference === null ? null : originReference]);
    }
    updates.push([target, changes]);
  }
  const roots = new Array(updates.length);
  await runStorageBatch(
    updates.map(([collection, entries], slot) => ({ collection, entries, slot })),
    async ({ collection, entries, slot }) => {
      const previous = await previousCollectionRoot(collection);
      roots[slot] = [collection, await index.setMany(previous, entries)];
    },
  );
  return roots;
}

export async function applyImmutableCommitMutations(options) {
  const roots = await prepareCollectionRoots(options);
  return options.index.setMany(options.previousRoot, roots);
}

async function prepareCommitOrder({ objects, orderRoot, generation, commit }) {
  const commitIndex = new ImmutableRadixIndex(objects, IMMUTABLE_COMMIT_INDEX_TARGET_BYTES);
  const commitOrder = await commitIndex.set(orderRoot, immutableOrderKey(generation), commit);
  return ["commitOrder", commitOrder];
}

export async function indexImmutableCommit(options) {
  const entry = await prepareCommitOrder({
    ...options,
    orderRoot: await options.index.get(options.root, "commitOrder"),
  });
  return options.index.setMany(options.root, [entry]);
}

export async function buildImmutableCommitRoot(options) {
  const roots = new Map(await prepareCollectionRoots(options));
  const orderRoot = roots.has("commitOrder")
    ? roots.get("commitOrder")
    : await options.index.get(options.previousRoot, "commitOrder");
  const [collection, reference] = await prepareCommitOrder({ ...options, orderRoot });
  roots.set(collection, reference);
  return options.index.setMany(options.previousRoot, [...roots]);
}
