/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { filePath as path } from "@noobot/path-resolver";
import {
  PARTITION_COLLECTION_FRAME,
  PARTITION_JOURNAL_FRAME,
  decodePartitionJournalFrameRequest,
  encodePartitionJournalFrameRequest,
  partitionCollectionSlotOffset,
} from "@noobot/session-protocol/partition-journal";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import {
  encodeJournalFrame,
  journalPartitionPath,
} from "../../src/session/partition-storage/journal-io.js";
import {
  commitFixtureTransaction,
  createTransactionCase,
} from "../helpers/partition-journal-cases.js";
import { observeStorageIo } from "../helpers/storage-io-observation.js";
import { createPartitionCollectionReadBudget } from "@noobot/session-protocol/partition-collection-query";

test("scoped frame reuse still reads selected values and expires with the scope", async (context) => {
  const { journal, root } = await createTransactionCase(context, {}, { autoClose: false });
  context.after(() => assert.rejects(journal.close(), { code: "SESSION_STORAGE_CORRUPT" }));
  const committed = await commitFixtureTransaction(new PartitionTransactions(journal), {
    epoch: journal.head.epoch,
    sequence: 1,
    expectedGeneration: 0,
    operationId: "scoped-frame",
    input: null,
    mutations: [{ collection: "messages", key: "selected", owner: null, value: "original" }],
    result: null,
  });
  const file = journalPartitionPath(root, committed.reference.partition);
  const original = await readFile(file);
  await observeStorageIo(root, async (readBytes) =>
    journal.usingSnapshot(async (snapshot) => {
      const read = (readBudget = createPartitionCollectionReadBudget(snapshot)) =>
        journal.readRecordSlots({
          snapshot,
          reference: committed.reference,
          slots: [0],
          readBudget,
        });
      let firstBytes;
      await journal.withRecordReader(snapshot, async () => {
        const before = readBytes();
        const first = await read();
        firstBytes = readBytes() - before;
        const repeatedBefore = readBytes();
        const repeated = await read();
        assert.deepEqual(repeated, first);
        assert.ok(readBytes() - repeatedBefore < firstBytes);
        await assert.rejects(
          read({
            consume: () => {
              throw new Error("read budget exhausted");
            },
          }),
          /read budget exhausted/,
        );
      });
      const separateBefore = readBytes();
      await journal.withRecordReader(snapshot, read);
      assert.equal(readBytes() - separateBefore, firstBytes);
      await journal.withRecordReader(snapshot, async () => {
        await read();
        const damaged = Buffer.from(original);
        damaged[damaged.indexOf("original")] = 0x58;
        await writeFile(file, damaged);
        try {
          await assert.rejects(read(), { code: "SESSION_STORAGE_CORRUPT" });
        } finally {
          await writeFile(file, original);
        }
      });
      const damaged = Buffer.from(original);
      damaged[damaged.length - 1] = 0x58;
      await writeFile(file, damaged);
      try {
        await assert.rejects(journal.withRecordReader(snapshot, read), {
          code: "SESSION_STORAGE_CORRUPT",
        });
      } finally {
        await writeFile(file, original);
      }
    }),
  );
});

test("committed mutation shape is checked before point identity and during frame replay", async (t) => {
  const { journal, root } = await createTransactionCase(t, {}, { autoClose: false });
  t.after(() => assert.rejects(journal.close(), { code: "SESSION_STORAGE_CORRUPT" }));
  const writer = new PartitionTransactions(journal);
  const cursor = journal.head.tail;
  const collection = "messages";
  const key = "m";
  const committed = await commitFixtureTransaction(writer, {
    epoch: journal.head.epoch,
    sequence: 1,
    expectedGeneration: 0,
    operationId: "operation-1",
    input: null,
    mutations: [{ collection, key, owner: null, value: 1 }],
    result: null,
  });
  const file = journalPartitionPath(root, committed.reference.partition);
  const original = await readFile(file);
  const { headerBytes } = PARTITION_JOURNAL_FRAME;
  const request = decodePartitionJournalFrameRequest(
    original.subarray(headerBytes, headerBytes + original.readUInt32BE(0)),
    "collections",
  );
  await journal.usingSnapshot(async (snapshot) => {
    const point = { snapshot, ...committed.mutations[0] };
    await assert.rejects(writer.readEntity({ ...point, key: "other" }), {
      code: "SESSION_STORAGE_IDENTITY",
    });
    await assert.rejects(
      writer.readEntity({ ...point, reference: { ...point.reference, slot: 1 } }),
      { code: "SESSION_STORAGE_IDENTITY" },
    );
    request.payload.mutations[0].key = null;
    const { body } = encodePartitionJournalFrameRequest(request, snapshot.limits, "collections");
    const validBody = original.subarray(headerBytes, headerBytes + original.readUInt32BE(0));
    const badTable = Buffer.from(validBody);
    badTable.writeUInt32BE(0, partitionCollectionSlotOffset(0));
    const badUtf8 = Buffer.from(validBody);
    const mutationOffset = badUtf8.readUInt32BE(partitionCollectionSlotOffset(0));
    badUtf8[mutationOffset + 2] = 0xff;
    const reads = [
      () => writer.readEntity(point),
      () => writer.read({ snapshot, reference: committed.reference }),
      () => journal.readPage({ snapshot, cursor }),
    ];
    for (const [label, damaged] of [
      ["invalid mutation shape", encodeJournalFrame(body).frame],
      ["invalid slot table", encodeJournalFrame(badTable).frame],
      ["invalid UTF-8", encodeJournalFrame(badUtf8).frame],
      ["physical truncation", original.subarray(0, -1)],
    ]) {
      await writeFile(file, damaged);
      for (const read of reads)
        await assert.rejects(read, { code: "SESSION_STORAGE_CORRUPT" }, label);
    }
  });
});

test("cold point reads skip unrelated values in the selected transaction", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, {
    pageBytes: 4096,
    receiptRecords: 1,
  });
  const collection = "messages";
  const writer = new PartitionTransactions(journal);
  const commit = (sequence, mutations) =>
    commitFixtureTransaction(writer, {
      epoch: journal.head.epoch,
      sequence,
      expectedGeneration: sequence - 1,
      operationId: `operation-${sequence}`,
      input: null,
      mutations,
      result: null,
    });
  const put = (key, value, owner = null) => ({ collection, key, owner, value });
  const created = await commit(1, [put("m", 1), put("other", 1)]);
  const updated = await commit(2, [
    put("other", "x".repeat(3100), created.mutations[1].owner),
    put("m", "\u5c0f\u503c", created.mutations[0].owner),
  ]);
  await commit(3, []);
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const reader = new PartitionTransactions(reopened);
  await reopened.usingSnapshot(async (snapshot) => {
    const request = { snapshot, collection, keys: ["m"] };
    const file = path.relative(root, journalPartitionPath(root, 0));
    for (const read of [
      async () => (await reader.getLatestMany(request)).get("m"),
      async () => (await reader.getMany({ ...request, partition: 0 })).get("m"),
      () => reader.readEntity({ snapshot, ...updated.mutations[1] }),
    ]) {
      const { result, work } = await observeStorageIo(root, read);
      assert.equal(result.value, "\u5c0f\u503c");
      assert.ok(work.readBytesByPath.get(file) > 0 && work.readBytesByPath.get(file) < 512);
      assert.ok(work.readBytes <= snapshot.limits.pageBytes);
    }
  });
});

test("slot reads coalesce contiguous values without widening sparse reads", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, { pageBytes: 8192 });
  const writer = new PartitionTransactions(journal);
  const collection = "messages";
  const mutations = Array.from({ length: 6 }, (_, slot) => ({
    collection,
    key: `m-${slot}`,
    owner: null,
    value: slot === 2 ? "x".repeat(1800) : `value-${slot}`,
  }));
  const committed = await commitFixtureTransaction(writer, {
    epoch: journal.head.epoch,
    sequence: 1,
    expectedGeneration: 0,
    operationId: "operation-slots",
    input: null,
    mutations,
    result: null,
  });
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  await reopened.usingSnapshot(async (snapshot) => {
    const readSlots = async (slots) =>
      observeStorageIo(root, () =>
        reopened.readRecordSlots({ snapshot, reference: committed.reference, slots }),
      );
    const contiguous = await readSlots([0, 1, 2, 3]);
    const sparse = await readSlots([0, 3]);
    assert.equal(contiguous.result.size, 4);
    assert.equal(sparse.result.size, 2);
    assert.equal(contiguous.result.get(2).mutation.value, "x".repeat(1800));
    assert.equal(sparse.result.get(3).mutation.value, "value-3");
    assert.deepEqual(contiguous.result.get(3), sparse.result.get(3));

    assert.equal(contiguous.work.readCalls, 5);
    assert.equal(sparse.work.readCalls, 7);
    assert.ok(sparse.work.readBytes < contiguous.work.readBytes);
    assert.ok(sparse.work.readBytes < 1000);
  });
});

test("cold point reads reject corruption in the selected slot only", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, { receiptRecords: 1 });
  const writer = new PartitionTransactions(journal);
  const collection = "messages";
  const commit = (sequence, mutations) =>
    commitFixtureTransaction(writer, {
      epoch: journal.head.epoch,
      sequence,
      expectedGeneration: sequence - 1,
      operationId: `operation-${sequence}`,
      input: null,
      mutations,
      result: null,
    });
  const value = "selected value to corrupt";
  const first = await commit(1, [
    { collection, key: "damaged", owner: null, value },
    { collection, key: "intact", owner: null, value: 2 },
  ]);
  await commit(2, []);
  const file = journalPartitionPath(root, first.reference.partition);
  const bytes = await readFile(file);
  const offset = bytes.indexOf(value);
  assert.notEqual(offset, -1);
  assert.equal(bytes.lastIndexOf(value), offset);
  bytes[offset] = 0x53;
  await writeFile(file, bytes);

  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => assert.rejects(reopened.close(), { code: "SESSION_STORAGE_CORRUPT" }));
  const reader = new PartitionTransactions(reopened);
  await reopened.usingSnapshot(async (snapshot) => {
    for (const key of ["damaged", "intact"]) {
      const entity = first.mutations.find((mutation) => mutation.key === key);
      const query = { snapshot, collection, keys: [key] };
      for (const read of [
        () => reader.readEntity({ snapshot, ...entity }),
        async () =>
          (await reader.getMany({ ...query, partition: first.reference.partition })).get(key),
        async () => (await reader.getLatestMany(query)).get(key),
      ]) {
        if (key === "damaged") await assert.rejects(read, { code: "SESSION_STORAGE_CORRUPT" });
        else assert.equal((await read()).value, 2);
      }
    }
    await assert.rejects(reader.read({ snapshot, reference: first.reference }), {
      code: "SESSION_STORAGE_CORRUPT",
    });
  });
});

test("point reads reject a frame that extends into the unpublished physical tail", async (t) => {
  const { journal, root } = await createTransactionCase(t, {}, { autoClose: false });
  t.after(() => assert.rejects(journal.close(), { code: "SESSION_STORAGE_CORRUPT" }));
  const reader = new PartitionTransactions(journal);
  const collection = "messages";
  const key = "m";
  const committed = await commitFixtureTransaction(reader, {
    epoch: journal.head.epoch,
    sequence: 1,
    expectedGeneration: 0,
    operationId: "operation-1",
    input: null,
    mutations: [{ collection, key, owner: null, value: 1 }],
    result: null,
  });
  const partition = committed.reference.partition;
  const file = journalPartitionPath(root, partition);
  const { headerBytes, trailer } = PARTITION_JOURNAL_FRAME;
  const prefixBytes = headerBytes + PARTITION_COLLECTION_FRAME.countBytes;
  await journal.usingSnapshot(async (snapshot) => {
    const published = await readFile(file);
    assert.equal(published.length, snapshot.tail.offset);
    const extended = Buffer.concat([published, Buffer.from(trailer)]);
    extended.writeUInt32BE(published.readUInt32BE(0) + Buffer.byteLength(trailer));
    await writeFile(file, extended);

    const entity = committed.mutations[0];
    const query = { snapshot, collection, keys: [key] };
    for (const read of [
      () => reader.readEntity({ snapshot, ...entity }),
      () => reader.getMany({ ...query, partition }),
      () => reader.getLatestMany(query),
    ]) {
      const { work } = await observeStorageIo(root, () =>
        assert.rejects(read, {
          code: "SESSION_STORAGE_CORRUPT",
          message: "Committed journal frame exceeds its boundary",
        }),
      );
      assert.equal(work.readBytesByPath.get(path.relative(root, file)), prefixBytes);
    }
  });
});
