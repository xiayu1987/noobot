/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { open } from "node:fs/promises";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { journalOffsetsPath } from "../../src/session/partition-storage/journal-offsets.js";
import { createJournalCase, journalRequest } from "../helpers/partition-journal-cases.js";
import { observeStorageIo } from "../helpers/storage-io-observation.js";

test("a snapshot reader shares body and index descriptors across distinct records", async (t) => {
  const { journal, root } = await createJournalCase(t);
  const records = await Promise.all(
    [1, 2, 3].map((n) => journal.append(journalRequest(journal, n))),
  );
  await journal.usingSnapshot(async (snapshot) => {
    const read = ({ reference }) => journal.readRecord({ snapshot, reference });
    const readRecords = async () => {
      const first = await journal.withRecordReader(snapshot, () => read(records[0]));
      return [first, ...(await Promise.all(records.slice(1).map(read)))];
    };
    const { result, work } = await observeStorageIo(root, () =>
      journal.withRecordReader(snapshot, readRecords),
    );
    assert.deepEqual(
      result.map(({ request }) => request.sequence),
      [1, 2, 3],
    );
    assert.equal(work.openCalls, 2, "one index and one body descriptor for the active partition");
    const { work: separate } = await observeStorageIo(root, () =>
      journal.readRecord({ snapshot, reference: records[0].reference }),
    );
    assert.equal(separate.openCalls, 2, "descriptors do not outlive the reader scope");
  });
});

test("a snapshot reader reuses descriptors across partitions with a fixed bound", async (t) => {
  const { journal, root } = await createJournalCase(t, { partitionRecords: 2 });
  const records = [];
  for (let sequence = 1; sequence <= 10; sequence++)
    records.push(await journal.append(journalRequest(journal, sequence)));
  await journal.usingSnapshot(async (snapshot) => {
    const read = ({ reference }) => journal.readRecord({ snapshot, reference });
    for (const record of records) await read(record);
    const { work, result } = await observeStorageIo(root, () =>
      journal.withRecordReader(snapshot, async () => {
        const messages = [];
        for (const record of records) messages.push((await read(record)).request.sequence);
        return messages;
      }),
    );
    assert.deepEqual(
      result,
      records.map((_, index) => index + 1),
    );
    assert.equal(work.openCalls, 12, "four partitions are shared; the fifth uses per-record I/O");
    const { work: separate } = await observeStorageIo(root, () => read(records[2]));
    assert.equal(separate.openCalls, 2, "sealed partition descriptors do not outlive the scope");
  });
});

test("logical handles read one old record with fixed I/O after history growth and reopen", async (t) => {
  const { journal, root, sessionId } = await createJournalCase(t, { partitionRecords: 2 });
  const first = await journal.append(journalRequest(journal, 1));
  await journal.append(journalRequest(journal, 2));
  await journal.usingSnapshot(async (oldSnapshot) => {
    const measurements = [];
    for (const count of [10, 100, 1000]) {
      while (journal.head.sequence < count) {
        const firstSequence = journal.head.sequence + 1;
        const size = Math.min(16, count - journal.head.sequence);
        await Promise.all(
          Array.from({ length: size }, (_, offset) =>
            journal.append(journalRequest(journal, firstSequence + offset)),
          ),
        );
      }
      await journal.usingSnapshot(async (snapshot) => {
        const readBefore = journal.work.readBytes;
        const { result, work } = await observeStorageIo(root, () =>
          journal.readRecord({ snapshot, reference: first.reference }),
        );
        assert.equal(result.request.sequence, 1);
        assert.deepEqual(result.request.payload, { delta: "hello" });
        assert.equal(work.openCalls, 3);
        measurements.push({
          readBytes: journal.work.readBytes - readBefore,
          openCalls: work.openCalls,
        });
      });
    }
    assert.deepEqual(measurements[0], measurements[1]);
    assert.deepEqual(measurements[0], measurements[2]);
    assert.equal(
      (await journal.readRecord({ snapshot: oldSnapshot, reference: first.reference })).request
        .sequence,
      1,
    );
    const reopened = await PartitionJournal.open({ root, sessionId });
    t.after(() => reopened.close());
    await reopened.usingSnapshot(async (snapshot) => {
      assert.equal(
        (await reopened.readRecord({ snapshot, reference: first.reference })).request.sequence,
        1,
      );
    });
  });
});

test("replayed append returns the same logical handle without another data publication", async (t) => {
  const { journal, root, sessionId } = await createJournalCase(t);
  const request = journalRequest(journal, 1);
  const first = await journal.append(request);
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const publications = reopened.work.publications;
  const retry = await reopened.append(request);
  assert.equal(retry.replayed, true);
  assert.deepEqual(retry.reference, first.reference);
  assert.equal(reopened.work.publications, publications);
});

test("invalid and future handles fail before disk reads; old snapshots cannot read later records", async (t) => {
  const { journal } = await createJournalCase(t);
  await journal.usingSnapshot(async (before) => {
    const first = await journal.append(journalRequest(journal, 1));
    await journal.usingSnapshot(async (snapshot) => {
      const readBytes = journal.work.readBytes;
      for (const reference of [
        { ...first.reference, sequence: 0 },
        { ...first.reference, partition: -1 },
        { ...first.reference, offset: 0 },
        { ...first.reference, sequence: 2 },
        { ...first.reference, epoch: "0".repeat(32) },
      ])
        await assert.rejects(journal.readRecord({ snapshot, reference }));
      await assert.rejects(
        journal.readRecord({ snapshot: before, reference: first.reference }),
        RangeError,
      );
      assert.equal(journal.work.readBytes, readBytes);
    });
  });
});

test("wrong partition and corrupted offset cannot silently resolve to another committed record", async (t) => {
  const { journal, root } = await createJournalCase(
    t,
    { partitionRecords: 2 },
    { autoClose: false },
  );
  t.after(() => assert.rejects(journal.close(), { code: "SESSION_STORAGE_CORRUPT" }));
  const results = await Promise.all(
    [1, 2, 3].map((sequence) => journal.append(journalRequest(journal, sequence))),
  );
  await journal.usingSnapshot(async (snapshot) => {
    await assert.rejects(
      journal.readRecord({
        snapshot,
        reference: { ...results[0].reference, partition: 1 },
      }),
      RangeError,
    );
    const handle = await open(journalOffsetsPath(root, 0), "r+");
    try {
      const offset = Buffer.alloc(8);
      offset.writeBigUInt64BE(BigInt(results[1].cursor.offset));
      await handle.write(offset, 0, offset.length, 0);
    } finally {
      await handle.close();
    }
    await assert.rejects(journal.readRecord({ snapshot, reference: results[0].reference }), {
      code: "SESSION_STORAGE_CORRUPT",
    });
  });
});
