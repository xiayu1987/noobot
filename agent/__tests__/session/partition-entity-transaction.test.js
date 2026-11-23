/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import {
  commitFixtureTransaction,
  createTransactionCase,
} from "../helpers/partition-journal-cases.js";

for (const large of [false, true]) {
  test(`original entity transactions share directory and frame read budget, oversized=${large}`, async (t) => {
    const { journal, root, sessionId } = await createTransactionCase(t, {
      pageBytes: 4096,
      transactionBytes: 4096,
    });
    const writer = new PartitionTransactions(journal);
    const mutations = [
      { collection: "commands", key: "original", owner: null, value: { text: "receipt" } },
    ];
    if (large)
      mutations.push({ collection: "messages", key: "body", owner: null, value: "x".repeat(3800) });
    const committed = await commitFixtureTransaction(writer, {
      epoch: journal.head.epoch,
      expectedGeneration: 0,
      sequence: 1,
      operationId: "original",
      input: {},
      mutations,
      result: { commandId: "original" },
    });
    await journal.close();
    const reopened = await PartitionJournal.open({ root, sessionId });
    t.after(() => reopened.close());
    const reader = new PartitionTransactions(reopened);
    await reopened.usingSnapshot(async (snapshot) => {
      const before = reopened.work.readBytes;
      const read = reader.readEntityTransaction({
        snapshot,
        collection: "commands",
        key: "original",
      });
      if (large) await assert.rejects(read, { code: "SESSION_QUERY_BUDGET" });
      else {
        const original = await read;
        assert.equal(original.generation, committed.generation);
        assert.deepEqual(original.transaction.mutations, mutations);
      }
      assert.ok(reopened.work.readBytes - before <= snapshot.limits.pageBytes);
      assert.equal(
        await reader.readEntityTransaction({ snapshot, collection: "commands", key: "absent" }),
        null,
      );
    });
  });
}

test("original entity reads reject a referenced slot outside its original transaction", async (t) => {
  const { journal } = await createTransactionCase(t);
  const transactions = new PartitionTransactions(journal);
  await commitFixtureTransaction(transactions, {
    epoch: journal.head.epoch,
    expectedGeneration: 0,
    sequence: 1,
    operationId: "original",
    input: {},
    mutations: [
      { collection: "commands", key: "original", owner: null, value: { text: "receipt" } },
    ],
    result: null,
  });
  const readRecord = journal.readRecord.bind(journal);
  journal.readRecord = async (query) => {
    const record = await readRecord(query);
    record.request.payload.mutations = [];
    return record;
  };
  await journal.usingSnapshot((snapshot) =>
    assert.rejects(
      transactions.readEntityTransaction({ snapshot, collection: "commands", key: "original" }),
      { code: "SESSION_STORAGE_IDENTITY" },
    ),
  );
});
