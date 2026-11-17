/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { writeFile } from "node:fs/promises";
import { encodeImmutableSessionHead } from "@noobot/session-protocol/immutable-storage";
import { immutableMigrationCommitOrigins } from "@noobot/session-protocol/immutable-storage-graph";
import { applyImmutableCommitMutations } from "../../src/session/session-artifact-session/immutable-commit-roots.js";
import { immutableOrderKey } from "../../src/session/session-artifact-session/immutable-order-key.js";

export async function wrapLegacyCommitIndex(store, version = 3) {
  const head = await store.snapshot();
  const records = await store.objects.withSnapshot(head, async () => {
    const records = [];
    for (let generation = 1; generation <= head.generation; generation += 1) {
      const reference = await store.readCommitReference(head, generation);
      const record = await store.readCommitRecord(reference, generation);
      const receipt = await store.objects.readValue(
        await store.index.get(head.operations, record.operationId),
      );
      records.push({ record, receipt });
    }
    return records;
  });
  return store.objects.withDurabilityBatch(async () => {
    store.objects.beginCommit(head);
    let root = null;
    let operations = null;
    let commit = null;
    const commits = [];
    for (const { record, receipt } of records) {
      const mutations = [];
      for (const mutation of record.mutations)
        mutations.push(
          mutation.collection === "metadata" && mutation.key === "commitIndex"
            ? { ...mutation, reference: await store.objects.putValue({ version }) }
            : mutation,
        );
      root = await applyImmutableCommitMutations({
        index: store.index,
        objects: store.objects,
        previousRoot: root,
        generation: record.generation,
        mutations,
        origins: immutableMigrationCommitOrigins(version),
      });
      commit = await store.objects.putValue({ ...record, mutations, previous: commit });
      commits.push(commit);
      const order = await store.index.set(
        await store.index.get(root, "commitOrder"),
        immutableOrderKey(record.generation),
        await store.objects.putValue(commit),
      );
      root = await store.index.set(root, "commitOrder", order);
      operations = await store.index.set(
        operations,
        record.operationId,
        await store.objects.putValue({ ...receipt, commit }),
      );
    }
    await store.objects.publishReachable([
      head.root,
      head.operations,
      head.commit,
      root,
      operations,
      ...commits,
    ]);
    const legacy = { ...head, root, operations, commit, ...store.objects.publicationHeadFields() };
    await writeFile(store.headPath, encodeImmutableSessionHead(legacy, legacy.format));
    return legacy;
  });
}
