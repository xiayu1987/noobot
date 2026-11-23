/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import {
  decodePartitionJournalDirectory,
  requirePartitionJournalDirectory,
} from "@noobot/session-protocol/partition-journal";
import { createPartitionHistoricalOperationMutation } from "@noobot/session-protocol/partition-transaction";
import { journalDirectoryPath } from "../../src/session/partition-storage/journal-directory.js";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { partitionEntityPageWrite } from "../../src/session/partition-storage/partition-commit-observation.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { journalHeadPath } from "../../src/session/partition-storage/journal-io.js";
import {
  createTransactionCase,
  observeDirectoryPageReads,
} from "../helpers/partition-journal-cases.js";
import { observeStorageIo } from "../helpers/storage-io-observation.js";

const SAMPLE = 256;
const BATCH = 16;
const DELTA_BYTES = 1024;
const key = (sequence) => `m${String(sequence).padStart(8, "0")}`;
const operationIdFor = (sequence) => `test-operation-${sequence - 1}`;

function historyMutation(sequence, operationId) {
  return createPartitionHistoricalOperationMutation({
    format: "noobot.immutable-migration-operation/1",
    operationId,
    receipt: {
      generation: sequence,
      commit: "a".repeat(64),
      digest: "b".repeat(64),
      result: null,
    },
  });
}

function directoryReadBytes(journal) {
  return journal.work.entityDirectoryReadBytesByLevel.reduce((sum, bytes) => sum + bytes, 0);
}

async function observeDirectoryWrites(run) {
  const byRoot = Object.create(null);
  const countPageWrite = ({ root, level, bytes }) => {
    const levels = (byRoot[root] ??= []);
    levels[level] = (levels[level] ?? 0) + bytes;
  };
  partitionEntityPageWrite.subscribe(countPageWrite);
  try {
    return { result: await run(), byRoot };
  } finally {
    partitionEntityPageWrite.unsubscribe(countPageWrite);
  }
}

async function append(
  reader,
  first,
  count,
  { latencies, withHistoricalOperations = false, phases } = {},
) {
  for (let offset = 0; offset < count; offset += BATCH) {
    const commits = [];
    for (let i = offset; i < Math.min(offset + BATCH, count); i += 1) {
      const sequence = first + i;
      const operationId = operationIdFor(sequence);
      const started = performance.now();
      const request = {
        epoch: reader.journal.head.epoch,
        expectedGeneration: sequence - 1,
        operationId,
        input: { fixtureGeneration: sequence - 1 },
      };
      const mutations = [
        { collection: "messages", key: key(sequence), owner: null, value: "x".repeat(DELTA_BYTES) },
        ...(withHistoricalOperations ? [historyMutation(sequence, operationId)] : []),
      ];
      let readsBeforeAdmission;
      let firstPageRead;
      commits.push(
        reader
          .commit(request, {
            validateScope() {
              if (!phases) return;
              assert.ok(phases.batch, "admission must follow a locked CURRENT read");
              phases.batch.records += 1;
              readsBeforeAdmission = reader.journal.work.entityDirectoryReadBytesByLevel.slice();
              firstPageRead = phases.reads.length;
            },
            prepare() {
              if (phases) {
                reader.journal.work.entityDirectoryReadBytesByLevel.forEach((bytes, level) => {
                  phases.admission[level] =
                    (phases.admission[level] ?? 0) + bytes - (readsBeforeAdmission[level] ?? 0);
                });
                for (let index = firstPageRead; index < phases.reads.length; index += 1) {
                  const [file, position, bytes] = phases.reads[index];
                  const page = `${file}:${position}`;
                  if (phases.batch.positions.has(page)) phases.repeatedBytes += bytes;
                  else phases.firstBytes += bytes;
                  phases.batch.positions.add(page);
                }
              }
              return { action: "commit", mutations, result: null };
            },
          })
          .then(() => {
            if (latencies) latencies.push(performance.now() - started);
          }),
      );
    }
    await Promise.all(commits);
  }
}

async function measureGrowth(t, { seedHistory, importHistory }) {
  const rows = [];
  for (const history of [10, 1000, 10000]) {
    const { journal, root, sessionId } = await createTransactionCase(t);
    const reader = new PartitionTransactions(journal);
    await append(reader, 1, history, { withHistoricalOperations: seedHistory });
    const coldWriter = await PartitionJournal.open({ root, sessionId });
    t.after(() => coldWriter.close());
    const historicalRoot = coldWriter.head.entityDirectory.historicalOperations;
    assert.equal(historicalRoot !== null, seedHistory);
    const { work: coldWrite } = await observeStorageIo(root, () =>
      append(new PartitionTransactions(coldWriter), history + 1, 1),
    );
    assert.deepEqual(coldWriter.head.entityDirectory.historicalOperations, historicalRoot);
    await coldWriter.close();
    const beforeImport = importHistory ? await journal.snapshot() : null;
    let snapshot;
    try {
      const coldFile = journalDirectoryPath(root, 0);
      const coldBefore = journal.head.tail.partition > 0 ? await readFile(coldFile) : null;
      const latency = [];
      const phases = { admission: [], firstBytes: 0, repeatedBytes: 0, batches: [] };
      const currentPath = journalHeadPath(root);
      const directoryBefore = directoryReadBytes(journal);
      const directoryWritesBefore = journal.work.entityDirectoryWriteBytesByLevel.slice();
      const writesBefore = journal.work.writeBytes;
      const {
        result: { work },
        byRoot,
      } = await observeDirectoryWrites(() =>
        observeStorageIo(root, () =>
          observeDirectoryPageReads(
            (reads) => {
              phases.reads = reads;
              return append(reader, history + 2, SAMPLE, {
                latencies: latency,
                withHistoricalOperations: importHistory,
                phases,
              });
            },
            (file, flags) => {
              if (flags !== "r" || file !== currentPath) return;
              phases.batch = { records: 0, positions: new Set() };
              phases.batches.push(phases.batch);
            },
          ),
        ),
      );
      const directoryBytes = directoryReadBytes(journal) - directoryBefore;
      const directoryWrites = journal.work.entityDirectoryWriteBytesByLevel.map(
        (bytes, level) => bytes - (directoryWritesBefore[level] ?? 0),
      );
      for (const [level, bytes] of directoryWrites.entries()) {
        assert.equal(
          Object.values(byRoot).reduce((sum, levels) => sum + (levels[level] ?? 0), 0),
          bytes,
        );
      }
      assert.equal(Object.hasOwn(byRoot, "undefined"), false, "written directory page has no root");
      assert.equal(Object.hasOwn(byRoot, "historicalOperations"), importHistory);
      const journalWrites = journal.work.writeBytes - writesBefore;
      const admissionBytes = phases.admission.reduce((sum, bytes) => sum + bytes, 0);
      const batchSizes = phases.batches.map(({ records }) => records).filter(Boolean);
      assert.equal(
        batchSizes.reduce((sum, records) => sum + records, 0),
        SAMPLE,
      );
      assert.equal(phases.firstBytes + phases.repeatedBytes, admissionBytes);
      snapshot = await journal.snapshot();
      if (importHistory) {
        assert.notDeepEqual(snapshot.entityDirectory.historicalOperations, historicalRoot);
      } else {
        assert.deepEqual(snapshot.entityDirectory.historicalOperations, historicalRoot);
      }
      if (coldBefore) assert.deepEqual(await readFile(coldFile), coldBefore);
      if (snapshot.tail.partition > 0) {
        const sealed = requirePartitionJournalDirectory(
          decodePartitionJournalDirectory(await readFile(coldFile, "utf8")),
          snapshot,
          0,
        );
        assert.notEqual(sealed.collectionRoot, null);
      }
      assert.equal(work.syncCalls, work.completedSyncs);
      const reopened = await PartitionJournal.open({ root, sessionId });
      t.after(() => reopened.close());
      assert.ok(reopened.work.readBytes <= snapshot.limits.receiptBytes + 64 * 1024);
      const recoveryBytes = reopened.work.readBytes;
      const restored = new PartitionTransactions(reopened);
      const { result: oldest, work: coldLookup } = await observeStorageIo(root, () =>
        restored.getMany({ snapshot, partition: 0, collection: "messages", keys: [key(1)] }),
      );
      assert.equal(oldest.get(key(1)).value.length, DELTA_BYTES);
      const coldLookupBytes = coldLookup.readBytes;
      assert.ok(coldLookupBytes < snapshot.limits.partitionBytes);
      const current = {
        snapshot,
        partition: snapshot.tail.partition,
        collection: "messages",
        keys: [key(snapshot.sequence)],
      };
      const latest = await restored.getMany(current);
      assert.equal(latest.get(key(snapshot.sequence)).value.length, DELTA_BYTES);
      const beforeHot = reopened.work.readBytes;
      const reference = (await restored.lookupMany(current)).get(key(snapshot.sequence));
      assert.equal(reference.record.partition, snapshot.tail.partition);
      assert.equal(reference.record.sequence, snapshot.sequence);
      assert.equal(reopened.work.readBytes, beforeHot);
      const receiptSequence = snapshot.sequence;
      const {
        collection,
        key: receiptKey,
        value,
      } = historyMutation(receiptSequence, operationIdFor(receiptSequence));
      const receiptReader = await PartitionJournal.open({ root, sessionId });
      t.after(() => receiptReader.close());
      const historyReader = new PartitionTransactions(receiptReader);
      const { result: receipt, work: coldReceiptLookup } = await observeStorageIo(
        root,
        async () => {
          const receipts = await historyReader.getLatestMany({
            snapshot,
            collection,
            keys: [receiptKey],
          });
          return receipts.get(receiptKey);
        },
      );
      if (importHistory) {
        assert.deepEqual(receipt.value, value);
        const original = historyMutation(1, operationIdFor(1));
        const before = await historyReader.getLatestMany({
          snapshot: beforeImport,
          collection,
          keys: [original.key, receiptKey],
        });
        assert.deepEqual(before.get(original.key).value, original.value);
        assert.equal(before.get(receiptKey), null);
      } else assert.equal(receipt, null);
      latency.sort((a, b) => a - b);
      rows.push({
        historyRecords: history,
        seedHistory,
        importHistory,
        coldWriteReadBytes: coldWrite.readBytes,
        warmWriteReadBytesPerTransaction: work.readBytes / SAMPLE,
        warmAdmissionDirectoryReadBytesPerTransaction: admissionBytes / SAMPLE,
        warmFirstAdmissionDirectoryReadBytesPerTransaction: phases.firstBytes / SAMPLE,
        warmRepeatedAdmissionDirectoryReadBytesPerTransaction: phases.repeatedBytes / SAMPLE,
        warmAdmissionDirectoryReadBytesByLevelPerTransaction: phases.admission.map(
          (bytes) => bytes / SAMPLE,
        ),
        warmOtherDirectoryReadBytesPerTransaction: (directoryBytes - admissionBytes) / SAMPLE,
        measuredTransactions: SAMPLE,
        measuredBatches: batchSizes.length,
        maxTransactionsPerBatch: Math.max(...batchSizes),
        adapterWriteBytesPerTransaction: work.writeBytes / SAMPLE,
        directoryWriteBytesByLevelPerTransaction: directoryWrites.map((bytes) => bytes / SAMPLE),
        directoryWriteBytesByRootAndLevelPerTransaction: Object.fromEntries(
          Object.entries(byRoot).map(([name, levels]) => [
            name,
            levels.map((bytes) => bytes / SAMPLE),
          ]),
        ),
        nonDirectoryJournalWriteBytesPerTransaction:
          (journalWrites - directoryWrites.reduce((sum, bytes) => sum + bytes, 0)) / SAMPLE,
        otherAdapterWriteBytesPerTransaction: (work.writeBytes - journalWrites) / SAMPLE,
        syncs: work.syncCalls,
        coldLookupBytes,
        coldLookupReadBytesByPath: Object.fromEntries(coldLookup.readBytesByPath),
        coldHistoricalReceiptLookupBytes: coldReceiptLookup.readBytes,
        recoveryBytes,
        p50Ms: latency[Math.floor(SAMPLE * 0.5)],
        p99Ms: latency[Math.floor(SAMPLE * 0.99)],
        profile: snapshot.publication,
      });
    } finally {
      try {
        if (snapshot) await journal.releaseSnapshot(snapshot);
      } finally {
        if (beforeImport) await journal.releaseSnapshot(beforeImport);
      }
    }
  }
  for (const row of rows) t.diagnostic(JSON.stringify(row));
  const violations = rows
    .filter((row) => row.adapterWriteBytesPerTransaction >= DELTA_BYTES * 3)
    .map(
      (row) =>
        `${row.historyRecords} history records: ${row.adapterWriteBytesPerTransaction} B/transaction exceeds the write gate`,
    );
  const writeCosts = rows.map((row) => row.adapterWriteBytesPerTransaction);
  const coldCosts = rows.map((row) => row.coldLookupBytes);
  const writeGrowth = Math.max(...writeCosts) / Math.min(...writeCosts);
  const coldGrowth = Math.max(...coldCosts) / Math.min(...coldCosts);
  if (!(writeGrowth < 1.1)) violations.push(`Write growth ${writeGrowth} exceeds the growth gate`);
  if (!(coldGrowth < 1.1))
    violations.push(`Cold lookup growth ${coldGrowth} exceeds the growth gate`);
  assert.equal(violations.length, 0, violations.join("\n"));
}

test("partition transaction growth E2E includes snapshot roots, cold lookup and recovery", (t) =>
  measureGrowth(t, { seedHistory: false, importHistory: false }));

test("partition transaction growth retains its original gates after importing historical operation evidence", (t) =>
  measureGrowth(t, { seedHistory: true, importHistory: false }));

test("partition transaction growth while importing historical operation evidence", (t) =>
  measureGrowth(t, { seedHistory: true, importHistory: true }));
