/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { stat } from "node:fs/promises";
import { PARTITION_ENTITY_DIRECTORY } from "@noobot/session-protocol/partition-entity-directory";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import {
  entityDirectoryPageDependencies,
  entityDirectoryPath,
  readEntityDirectoryNode,
} from "../../src/session/partition-storage/entity-directory-io.js";
import { readPartitionEntry } from "../../src/session/partition-storage/journal-directory.js";
import { getFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import {
  commitFixtureTransaction,
  createTransactionCase,
} from "../helpers/partition-journal-cases.js";

async function measureReachablePages(journal, snapshot) {
  const { identities, historicalOperations, latestUpdates } = snapshot.entityDirectory;
  const roots = [identities, historicalOperations, latestUpdates];
  for (let partition = 0; partition <= snapshot.tail.partition; partition += 1) {
    const { collectionRoot } = await readPartitionEntry({
      root: journal.root,
      head: snapshot,
      partition,
      work: journal.work,
    });
    roots.push(collectionRoot);
  }
  const pending = roots.filter((root) => root !== null).map((root) => root.position);
  const seen = new Map();
  let bytes = 0;
  while (pending.length) {
    const position = pending.pop();
    const identity = `${position.segment}:${position.offset}`;
    if (seen.has(identity)) {
      assert.equal(seen.get(identity), position.bytes, `conflicting page length at ${identity}`);
      continue;
    }
    seen.set(identity, position.bytes);
    const node = await readEntityDirectoryNode(journal, snapshot, position);
    bytes += position.bytes;
    for (const dependency of entityDirectoryPageDependencies(node)) pending.push(dependency);
  }
  return { pages: seen.size, bytes };
}

test("cold session entity lookup measures bounded directory paths without body scans", async (t) => {
  for (const count of [10, 1000, 10000]) {
    const { journal, root, sessionId } = await createTransactionCase(t, {
      partitionBytes: 256 * 1024,
      partitionRecords: 64,
    });
    const writer = new PartitionTransactions(journal);
    for (let first = 1; first <= count; first += 16) {
      await Promise.all(
        Array.from({ length: Math.min(16, count - first + 1) }, (_, index) => {
          const sequence = first + index;
          return commitFixtureTransaction(writer, {
            epoch: journal.head.epoch,
            sequence,
            expectedGeneration: sequence - 1,
            operationId: `test-operation-${sequence - 1}`,
            input: { fixtureGeneration: sequence - 1 },
            mutations: [
              { collection: "messages", key: `message-${sequence}`, owner: null, value: sequence },
            ],
            result: null,
          });
        }),
      );
    }
    const samples = [];
    for (const sequence of [1, Math.ceil(count / 2), count]) {
      const reopened = await PartitionJournal.open({ root, sessionId });
      const reader = new PartitionTransactions(reopened);
      const snapshot = await reopened.snapshot();
      const adapter = getFsAdapter();
      let directoryOpens = 0;
      let bodyOpens = 0;
      const before = reopened.work.readBytes;
      setFsAdapter({
        ...adapter,
        async open(file, ...args) {
          if (String(file).endsWith(".pages")) directoryOpens += 1;
          if (String(file).endsWith("records.log")) bodyOpens += 1;
          return adapter.open(file, ...args);
        },
      });
      try {
        const entries = await reader.lookupLatestMany({
          snapshot,
          collection: "messages",
          keys: [`message-${sequence}`],
        });
        const { owner, reference } = entries.get(`message-${sequence}`);
        assert.equal(owner.sequence, sequence);
        assert.equal(reference.record.sequence, sequence);
        assert.equal(bodyOpens, 0);
        assert.ok(directoryOpens <= PARTITION_ENTITY_DIRECTORY.maxLevel + 1);
        samples.push({ sequence, directoryOpens, readBytes: reopened.work.readBytes - before });
      } finally {
        setFsAdapter(adapter);
        await reopened.releaseSnapshot(snapshot);
        await reopened.close();
      }
    }
    const beforeUpdateBytes = journal.head.entityDirectory.bytes;
    await commitFixtureTransaction(writer, {
      epoch: journal.head.epoch,
      sequence: count + 1,
      expectedGeneration: count,
      operationId: `test-operation-${count}`,
      input: { fixtureGeneration: count },
      mutations: [{ collection: "messages", key: "zz-probe", owner: null, value: 1 }],
      result: null,
    });
    const snapshot = await journal.snapshot();
    let directoryFileBytes = 0;
    for (let segment = 0; segment <= snapshot.entityDirectory.segment; segment += 1)
      directoryFileBytes += (await stat(entityDirectoryPath(root, segment))).size;
    assert.equal(directoryFileBytes, snapshot.entityDirectory.bytes);
    const reachable = await measureReachablePages(journal, snapshot);
    assert.ok(reachable.bytes <= directoryFileBytes);
    t.diagnostic(
      JSON.stringify({
        historyEntities: count,
        directoryFileBytes,
        singleCreateDirectoryBytes: directoryFileBytes - beforeUpdateBytes,
        reachableDirectoryBytes: reachable.bytes,
        reachableDirectoryPages: reachable.pages,
        unreachableFromSnapshotBytes: directoryFileBytes - reachable.bytes,
        samples,
        limitation:
          "reachability is from the current root; old snapshot retention and safe reclamation are not measured",
      }),
    );
    await journal.releaseSnapshot(snapshot);
  }
});
