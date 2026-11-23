/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { performance } from "node:perf_hooks";
import { lstat, readdir, stat } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import {
  PARTITION_JOURNAL_FRAME,
  PARTITION_JOURNAL_PUBLICATION_LOCK,
  PARTITION_SNAPSHOT_OWNERSHIP_DIRECTORY,
  partitionJournalReservedInodes,
} from "@noobot/session-protocol/partition-journal";
import { createJournalCase, journalRequest } from "../helpers/partition-journal-cases.js";
import { observeStorageIo } from "../helpers/storage-io-observation.js";

const BATCH = 16;
const SAMPLE = 256;
const DELTA_BYTES = 1024;
const origin = { partition: 0, offset: 0, sequence: 0 };

function payload(mode, sequence) {
  return {
    turnScopeId: String(mode === "long-turn" ? 1 : sequence).padStart(8, "0"),
    chunkSequence: String(mode === "long-turn" ? sequence : 1).padStart(8, "0"),
    delta: "x".repeat(DELTA_BYTES),
  };
}

async function appendRange(journal, mode, first, count, latency = null) {
  let last;
  for (let offset = 0; offset < count; offset += BATCH) {
    const promises = [];
    for (let position = offset; position < Math.min(offset + BATCH, count); position += 1) {
      const sequence = first + position;
      const started = performance.now();
      promises.push(
        journal
          .append(journalRequest(journal, sequence, payload(mode, sequence)))
          .then((result) => {
            if (latency) latency.push(performance.now() - started);
            return result;
          }),
      );
    }
    last = (await Promise.all(promises)).at(-1);
  }
  return last;
}

async function diskUsage(directory) {
  let bytes = 0;
  let allocated = 0;
  let files = 0;
  let directories = 1;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await diskUsage(file);
      bytes += nested.bytes;
      allocated += nested.allocated;
      files += nested.files;
      directories += nested.directories;
    } else {
      const info = await stat(file);
      bytes += info.size;
      allocated += info.blocks * 512;
      files += 1;
    }
  }
  return { bytes, allocated, files, directories };
}

function difference(after, before, key) {
  return after[key] - before[key];
}

for (const mode of ["long-turn", "many-turns"]) {
  test(`partition journal storage E2E: ${mode}, 10 / 1000 / 10000 records`, async (t) => {
    const rows = [];
    for (const history of [10, 1000, 10000]) {
      const { journal, root, sessionId } = await createJournalCase(t);
      const lockPath = path.join(root, PARTITION_JOURNAL_PUBLICATION_LOCK);
      const lock = await lstat(lockPath);
      assert.ok(lock.isFile());
      assert.equal(lock.size, 0);
      await appendRange(journal, mode, 1, history);
      const before = { ...journal.work };
      const latency = [];
      const started = performance.now();
      const { result: last, work: fileSystemWork } = await observeStorageIo(root, () =>
        appendRange(journal, mode, history + 1, SAMPLE, latency),
      );
      const durationMs = performance.now() - started;
      const after = { ...journal.work };
      assert.equal(fileSystemWork.syncCalls, fileSystemWork.completedSyncs);
      assert.ok(fileSystemWork.syncCalls >= 2 * difference(after, before, "dataSyncs"));
      assert.ok(
        fileSystemWork.writeBytes >=
          difference(after, before, "writeBytes") + difference(after, before, "controlWriteBytes"),
      );
      const snapshot = await journal.snapshot();
      const readBefore = journal.work.readBytes;
      const page = await journal.readPage({ snapshot, cursor: last.cursor });
      const pageReadBytes = journal.work.readBytes - readBefore;
      const locateBefore = journal.work.readBytes;
      const locateOpens = journal.work.partitionOpens;
      const located = await journal.readSequencePage({ snapshot, sequence: history + SAMPLE });
      const sequenceLookupReadBytes = journal.work.readBytes - locateBefore;
      assert.equal(located.records[0].request.sequence, history + SAMPLE);
      assert.deepEqual(located, page);
      assert.equal(sequenceLookupReadBytes, located.bytes + PARTITION_JOURNAL_FRAME.offsetBytes);
      assert.equal(journal.work.partitionOpens - locateOpens, 1);
      assert.equal(page.records.length, 1);
      assert.equal(page.records[0].request.sequence, history + SAMPLE);
      const restored = await PartitionJournal.open({ root, sessionId });
      t.after(() => restored.close());
      const openReadBytes = restored.work.readBytes;
      assert.equal(restored.work.partitionOpens, 0);
      const retry = journalRequest(restored, last.sequence, last.payload);
      assert.equal((await restored.append(retry)).replayed, true);
      assert.ok(restored.receipts.length <= restored.head.limits.receiptRecords);
      assert.ok(restored.work.readBytes <= restored.head.limits.receiptBytes + 64 * 1024);
      assert.equal(restored.head.sequence, history + SAMPLE);
      assert.equal(journal.queuedBytes, 0);
      const disk = await diskUsage(root);
      assert.ok(
        disk.files + disk.directories <=
          partitionJournalReservedInodes(snapshot) - snapshot.limits.reserveInodes,
      );
      assert.ok(
        disk.bytes - snapshot.dataBytes - snapshot.sequence * PARTITION_JOURNAL_FRAME.offsetBytes <
          64 * 1024 + (snapshot.tail.partition + 1) * PARTITION_JOURNAL_FRAME.directoryBytes,
      );
      const partitionFiles = (snapshot.tail.partition + 1) * 3;
      const { segment, offset } = snapshot.entityDirectory;
      const catalogFiles = segment + Number(offset > 0);
      const ownershipDirectory = path.join(root, PARTITION_SNAPSHOT_OWNERSHIP_DIRECTORY);
      assert.deepEqual(await readdir(ownershipDirectory), ["0.lock"]);
      const snapshotLockPath = path.join(ownershipDirectory, "0.lock");
      const snapshotLock = await lstat(snapshotLockPath);
      assert.ok(snapshotLock.isFile());
      assert.equal(snapshotLock.size, 0);
      assert.equal(disk.files, partitionFiles + catalogFiles + 4);
      assert.deepEqual(await readdir(path.join(root, "retentions")), ["0.json"]);
      assert.ok(pageReadBytes <= journal.head.limits.transactionBytes);
      latency.sort((left, right) => left - right);
      rows.push({
        mode,
        historyRecords: history,
        measuredTransactions: SAMPLE,
        fileSystemWork,
        dataWriteBytesPerTransaction: difference(after, before, "writeBytes") / SAMPLE,
        controlWriteBytesPerTransaction: difference(after, before, "controlWriteBytes") / SAMPLE,
        readBytesPerTransaction: difference(after, before, "readBytes") / SAMPLE,
        dataSyncs: difference(after, before, "dataSyncs"),
        publications: difference(after, before, "publications"),
        partitionOpens: difference(after, before, "partitionOpens"),
        p50Ms: Number(latency[Math.floor(latency.length * 0.5)].toFixed(3)),
        p99Ms: Number(latency[Math.floor(latency.length * 0.99)].toFixed(3)),
        transactionsPerSecond: Math.round((SAMPLE * 1000) / durationMs),
        openReadBytes,
        recoveryReadBytes: restored.work.readBytes,
        pageReadBytes,
        sequenceLookupReadBytes,
        retryWindowRecords: restored.receipts.length,
        disk,
        logicalDataBytes: snapshot.dataBytes,
      });
      let cursor = { ...origin };
      let count = 0;
      while (cursor.sequence < snapshot.sequence) {
        const exported = await restored.readPage({ snapshot, cursor });
        count += exported.records.length;
        cursor = exported.next;
      }
      assert.equal(count, history + SAMPLE);
      await restored.releaseSnapshot(snapshot);
      assert.deepEqual(await readdir(path.join(root, "retentions")), []);
      const finalLock = await lstat(lockPath);
      assert.ok(finalLock.isFile());
      assert.equal(finalLock.size, 0);
      assert.equal(finalLock.dev, lock.dev);
      assert.equal(finalLock.ino, lock.ino);
      const releasedLock = await lstat(snapshotLockPath);
      assert.equal(releasedLock.dev, snapshotLock.dev);
      assert.equal(releasedLock.ino, snapshotLock.ino);
      assert.equal((await diskUsage(root)).files, disk.files - 1);
    }
    assert.ok(
      Math.max(...rows.map((row) => row.dataWriteBytesPerTransaction)) -
        Math.min(...rows.map((row) => row.dataWriteBytesPerTransaction)) <=
        16,
    );
    assert.ok(
      Math.max(...rows.map((row) => row.controlWriteBytesPerTransaction)) -
        Math.min(...rows.map((row) => row.controlWriteBytesPerTransaction)) <=
        16,
    );
    for (const row of rows) t.diagnostic(JSON.stringify(row));
  });
}
