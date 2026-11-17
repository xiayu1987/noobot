/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ImmutableRadixIndex } from "./immutable-radix-index.js";
import { immutableStorageError } from "./immutable-object-store.js";
import { createImmutableReplayObjects } from "./immutable-replay-objects.js";
import { applyImmutableCommitMutations, immutableCommitIndex } from "./immutable-commit-roots.js";
import {
  encodeImmutableSessionHead,
  requireImmutableRetainedSnapshot,
  immutableSessionPhysicalHeadFields,
} from "@noobot/session-protocol/immutable-storage";

async function verifyRetainedHeads(heads, actual, replay) {
  if (!heads) return;
  for (const head of heads.values()) {
    const identity = { ...head, root: actual.root, operations: actual.operations };

    const physical = { ...actual, ...immutableSessionPhysicalHeadFields(head) };
    if (
      encodeImmutableSessionHead(identity, actual.format) !==
      encodeImmutableSessionHead(physical, actual.format)
    )
      throw immutableStorageError(
        `Historical head identity disagrees at generation ${actual.generation}`,
      );
    if (!(await replay.equivalent(head.root, actual.root)))
      throw immutableStorageError(
        `Historical state root disagrees at generation ${actual.generation}`,
      );
    if (!(await replay.equivalent(head.operations, actual.operations)))
      throw immutableStorageError(
        `Historical receipt root disagrees at generation ${actual.generation}`,
      );
  }
}

export async function verifyImmutableHistoryRoots(
  store,
  snapshot,
  { signal, retainedSnapshots = [], commitIndex = immutableCommitIndex },
) {
  const expected = new Map();
  for (const head of [...retainedSnapshots, snapshot]) {
    requireImmutableRetainedSnapshot(head, snapshot);
    if (!expected.has(head.generation)) expected.set(head.generation, new Map());
    expected.get(head.generation).set(encodeImmutableSessionHead(head, store.format), head);
  }
  const replay = createImmutableReplayObjects(store.objects);
  const { objects } = replay;
  const index = new ImmutableRadixIndex(objects);
  let root = null;
  let operations = null;
  for (let generation = 1; generation <= snapshot.generation; generation += 1) {
    signal?.throwIfAborted();
    const commit = await commitIndex.readReference(store, snapshot, generation);
    const record = await store.readCommitRecord(commit, generation);
    root = await applyImmutableCommitMutations({
      index,
      objects,
      previousRoot: root,
      generation,
      mutations: record.mutations,
      origins: commitIndex.origins,
    });
    root = await commitIndex.indexCommit({ index, objects, root, generation, commit });
    const receipt = await store.index.get(snapshot.operations, record.operationId);
    operations = await index.set(operations, record.operationId, receipt);
    await verifyRetainedHeads(
      expected.get(generation),
      {
        ...snapshot,
        generation,
        root,
        operations,
        commit,
      },
      replay,
    );
    replay.retain(root, operations);
  }
}
