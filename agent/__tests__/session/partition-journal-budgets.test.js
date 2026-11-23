/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PARTITION_JOURNAL_FRAME } from "@noobot/session-protocol/partition-journal";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import {
  commitFixtureTransaction,
  createJournalCase,
  createTransactionCase,
  journalRequest,
} from "../helpers/partition-journal-cases.js";

for (const { payloadBytes, receiptBytes, publications, retained } of [
  { payloadBytes: 100, receiptBytes: 16 * 1024, publications: 1, retained: 8 },
  { payloadBytes: 2300, receiptBytes: 4096, publications: 8, retained: 1 },
]) {
  test(`collection publication uses encoded frame bytes with a ${receiptBytes}-byte retry window`, async (t) => {
    const { journal, root, sessionId } = await createTransactionCase(t, { receiptBytes });
    const transactions = new PartitionTransactions(journal);
    const requests = Array.from({ length: 8 }, (_, index) => ({
      epoch: journal.head.epoch,
      sequence: index + 1,
      expectedGeneration: index,
      operationId: `batch-${index}`,
      input: null,
      mutations: [],
      result: "x".repeat(payloadBytes),
    }));
    const before = journal.work.publications;
    const results = await Promise.all(
      requests.map((request) => commitFixtureTransaction(transactions, request)),
    );
    assert.equal(journal.work.publications - before, publications);
    assert.equal(journal.head.sequence, 8);
    assert.equal(journal.receipts.length, retained);
    await journal.close();

    const reopened = await PartitionJournal.open({ root, sessionId });
    t.after(() => reopened.close());
    const restored = new PartitionTransactions(reopened);
    for (let index = 8 - retained; index < 8; index += 1) {
      const replay = await commitFixtureTransaction(restored, requests[index]);
      assert.equal(replay.replayed, true);
      assert.deepEqual(replay.result, results[index].result);
    }
    assert.equal(reopened.head.sequence, 8);
  });
}

test("paging charges header lookahead without reading an over-budget payload", async (t) => {
  const { journal } = await createJournalCase(t, { pageBytes: 4096 });
  await journal.append(journalRequest(journal, 1, { delta: "x".repeat(2000) }));
  await journal.append(journalRequest(journal, 2, { delta: "y".repeat(3000) }));
  const snapshot = await journal.snapshot();
  const before = journal.work.readBytes;
  const page = await journal.readPage({
    snapshot,
    cursor: { partition: 0, offset: 0, sequence: 0 },
  });
  assert.equal(page.records.length, 1);
  assert.equal(journal.work.readBytes - before, page.bytes + PARTITION_JOURNAL_FRAME.headerBytes);
  assert.ok(journal.work.readBytes - before <= snapshot.limits.pageBytes);
  const next = await journal.readPage({ snapshot, cursor: page.next });
  assert.equal(next.records.length, 1);
  assert.equal(next.done, true);
});

test("oversized JSON is rejected before visiting its remaining properties or allocating a frame", async (t) => {
  const { journal } = await createJournalCase(t);
  let visited = false;
  const payload = { delta: "x".repeat(1024 * 1024) };
  Object.defineProperty(payload, "later", {
    enumerable: true,
    get() {
      visited = true;
      throw new Error("must not execute");
    },
  });
  const before = { ...journal.work };
  await assert.rejects(journal.append(journalRequest(journal, 1, payload)), {
    code: "SESSION_TRANSACTION_BUDGET",
  });
  assert.equal(visited, false);
  assert.deepEqual(journal.work, before);
  assert.equal(journal.queuedBytes, 0);
});

test("journal rejects accessors and custom serialization without executing them", async (t) => {
  const { journal } = await createJournalCase(t);
  let visited = false;
  const payload = {};
  Object.defineProperty(payload, "delta", {
    enumerable: true,
    get() {
      visited = true;
      return "hidden";
    },
  });
  await assert.rejects(journal.append(journalRequest(journal, 1, payload)), /own data properties/);
  const custom = {
    toJSON() {
      visited = true;
      return "hidden";
    },
  };
  await assert.rejects(journal.append(journalRequest(journal, 1, custom)), /finite JSON/);
  assert.equal(visited, false);
});

test("JSON nesting is a protocol bound and invalid input leaves the writer usable", async (t) => {
  const { journal } = await createJournalCase(t);
  let payload = {};
  for (let index = 0; index <= PARTITION_JOURNAL_FRAME.maxJsonDepth; index += 1)
    payload = { next: payload };
  await assert.rejects(journal.append(journalRequest(journal, 1, payload)), /nesting/);
  const cyclic = {};
  cyclic.self = cyclic;
  await assert.rejects(journal.append(journalRequest(journal, 1, cyclic)), /cycles/);
  await journal.append(journalRequest(journal, 1, { delta: '😀\n"' }));
  assert.equal((await journal.snapshot()).sequence, 1);
});

test("journal rejects properties that JSON would silently discard", async (t) => {
  const { journal } = await createJournalCase(t);
  const symbol = { value: "x", [Symbol("extra")]: "hidden" };
  const hidden = Object.defineProperty({ value: "x" }, "extra", { value: "hidden" });
  const array = Object.assign(["x"], { extra: "hidden" });
  const symbolArray = ["x"];
  symbolArray[Symbol("extra")] = "hidden";
  const sparse = Array(2);
  sparse.extra = "hidden";
  const publications = journal.work.publications;
  for (const payload of [symbol, hidden, array, symbolArray, sparse])
    await assert.rejects(journal.append(journalRequest(journal, 1, payload)), TypeError);
  assert.equal(journal.work.publications, publications);
  await journal.append(journalRequest(journal, 1, [null, "x", 0]));
});

test("a completed cursor must match the snapshot's physical publication boundary", async (t) => {
  const { journal } = await createJournalCase(t);
  await journal.append(journalRequest(journal, 1));
  const snapshot = await journal.snapshot();
  await assert.rejects(
    journal.readPage({ snapshot, cursor: { partition: 0, offset: 0, sequence: 1 } }),
    /exceeds snapshot/,
  );
});
