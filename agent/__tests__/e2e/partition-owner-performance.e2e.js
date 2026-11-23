/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { performance } from "node:perf_hooks";
import { filePath as path } from "@noobot/path-resolver";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import {
  commitFixtureTransaction,
  createTransactionCase,
} from "../helpers/partition-journal-cases.js";
import { observeStorageIo } from "../helpers/storage-io-observation.js";

const SAMPLE = 256;
const BATCH = 16;
const DELTA = "x".repeat(1024);

function mutation(key, owner, value) {
  return { collection: "messages", key, owner, value };
}

function commit(reader, sequence, mutations) {
  return commitFixtureTransaction(reader, {
    epoch: reader.journal.head.epoch,
    sequence,
    expectedGeneration: sequence - 1,
    operationId: `test-operation-${sequence - 1}`,
    input: { fixtureGeneration: sequence - 1 },
    mutations,
    result: null,
  });
}

function messageKey(sequence) {
  return `message-${String(sequence).padStart(5, "0")}`;
}

async function appendUpdates(reader, { first, count, owner, mode, latencies, project }) {
  const { journal } = reader;
  const limit = journal.head.limits.partitionRecords;
  for (let offset = 0; offset < count;) {
    const remaining = limit - journal.head.partitionRecords;
    if (remaining === 0 && journal.head.deferredEntityUpdates !== null) await project();
    const end = Math.min(offset + Math.min(BATCH, remaining || limit), count);
    const tasks = [];
    for (let i = offset; i < end; i += 1) {
      const sequence = first + i;
      const mutations = [];
      if (mode !== "create")
        mutations.push(mutation("active", owner, mode === "mixed" ? sequence : DELTA));
      if (mode === "mixed" || mode === "create")
        mutations.push(mutation(messageKey(sequence), null, DELTA));
      const started = performance.now();
      tasks.push(
        commit(reader, sequence, mutations).then(() => {
          if (latencies) latencies.push(performance.now() - started);
        }),
      );
    }
    await Promise.all(tasks);
    offset = end;
  }
}

function bytesPerLevel(after, before) {
  return Array.from(after, (bytes, level) => ((bytes ?? 0) - (before[level] ?? 0)) / SAMPLE);
}

for (const mode of ["one-entity", "create", "update", "mixed"]) {
  test(`partition owner commit growth E2E: ${mode}`, async (t) => {
    const rows = [];
    for (const history of [10, 1000, 10000]) {
      const { journal, root, sessionId } = await createTransactionCase(t, {
        partitionBytes: 256 * 1024,
        partitionRecords: 64,
      });
      const reader = new PartitionTransactions(journal);
      const created = await commit(reader, 1, [
        mutation("active", null, DELTA),
        mutation("archived", null, "original"),
      ]);
      const [active, archived] = created.mutations;
      const { owner } = active;
      const updated = await commit(reader, 2, [mutation("archived", archived.owner, "updated")]);
      await reader.projectLatestUpdates();
      const project = () => reader.projectLatestUpdates();
      await appendUpdates(reader, {
        first: 3,
        count: history,
        owner,
        mode: mode === "one-entity" ? "update" : "create",
        project,
      });
      const latencies = [];
      const beforePartition = journal.head.tail.partition;
      const beforeReadBytes = journal.work.readBytes;
      const beforeDirectoryReads = [...journal.work.entityDirectoryReadBytesByLevel];
      const beforeDirectoryWrites = [...journal.work.entityDirectoryWriteBytesByLevel];
      let projectionReadBytes = 0;
      const measureProjection = async () => {
        const before = journal.work.readBytes;
        await project();
        projectionReadBytes += journal.work.readBytes - before;
      };
      const { work } = await observeStorageIo(root, async () => {
        await appendUpdates(reader, {
          first: history + 3,
          count: SAMPLE,
          owner,
          mode,
          latencies,
          project: measureProjection,
        });
        if (journal.head.deferredEntityUpdates !== null) await measureProjection();
      });
      const readBytes = journal.work.readBytes - beforeReadBytes;
      const readByLevel = bytesPerLevel(
        journal.work.entityDirectoryReadBytesByLevel,
        beforeDirectoryReads,
      );
      const writeByLevel = bytesPerLevel(
        journal.work.entityDirectoryWriteBytesByLevel,
        beforeDirectoryWrites,
      );
      const directoryReadBytesPerTransaction = readByLevel.reduce(
        (total, bytes) => total + bytes,
        0,
      );
      assert.equal(journal.head.tail.partition - beforePartition, 4);
      assert.equal(work.syncCalls, work.completedSyncs);
      if (mode === "one-entity")
        assert.ok(
          [...work.readBytesByPath.keys()].every((file) => path.basename(file) !== "records.log"),
        );
      assert.ok(work.writeBytes / SAMPLE < DELTA.length * 3);
      const reopened = await PartitionJournal.open({ root, sessionId });
      t.after(() => reopened.close());
      const restored = new PartitionTransactions(reopened);
      const snapshot = await reopened.snapshot();
      const lastKey = messageKey(snapshot.sequence);
      const query = {
        snapshot,
        collection: "messages",
        keys: ["active", "archived", lastKey, "missing"],
      };
      try {
        const references = await restored.lookupLatestMany(query);
        assert.ok(snapshot.tail.partition > owner.partition);
        assert.equal(
          references.get("active").reference.record.sequence,
          mode === "create" ? 1 : snapshot.sequence,
        );
        assert.deepEqual(references.get("active").owner, owner);
        assert.deepEqual(references.get("archived"), {
          owner: archived.owner,
          reference: updated.mutations[0].reference,
        });
        assert.equal(
          references.get(lastKey)?.reference.record.sequence ?? null,
          mode === "create" || mode === "mixed" ? snapshot.sequence : null,
        );
        assert.equal(references.get("missing"), null);
        const latest = await restored.getLatestMany(query);
        assert.equal(latest.get("active").value, mode === "mixed" ? snapshot.sequence : DELTA);
        assert.equal(latest.get("archived").value, "updated");
        assert.equal(latest.get("missing"), null);
      } finally {
        await reopened.releaseSnapshot(snapshot);
      }
      latencies.sort((left, right) => left - right);
      rows.push({
        mode,
        historyUpdates: history,
        measuredTransactions: SAMPLE,
        adapterWriteBytesPerTransaction: work.writeBytes / SAMPLE,
        adapterReadBytesByPathPerTransaction: Object.fromEntries(
          [...work.readBytesByPath].map(([file, bytes]) => [file, bytes / SAMPLE]),
        ),
        journalReadBytesPerTransaction: readBytes / SAMPLE,
        commitReadBytesPerTransaction: (readBytes - projectionReadBytes) / SAMPLE,
        projectionReadBytesPerTransaction: projectionReadBytes / SAMPLE,
        directoryReadBytesPerTransaction,
        directoryReadBytesByLevelPerTransaction: readByLevel,
        directoryWriteBytesByLevelPerTransaction: writeByLevel,
        otherJournalReadBytesPerTransaction: readBytes / SAMPLE - directoryReadBytesPerTransaction,
        p99Ms: latencies[Math.floor(SAMPLE * 0.99)],
      });
    }
    for (const row of rows) t.diagnostic(JSON.stringify(row));
    for (const metric of ["adapterWriteBytesPerTransaction", "journalReadBytesPerTransaction"]) {
      const costs = rows.map((row) => row[metric]);
      assert.ok(Math.max(...costs) / Math.min(...costs) < 1.1, metric);
    }
  });
}
