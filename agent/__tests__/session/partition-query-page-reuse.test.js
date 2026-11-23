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
  observeDirectoryPageReads,
} from "../helpers/partition-journal-cases.js";

const key = (index) => `${String(index).padStart(2, "0")}-${"message".repeat(10)}`;

test("one-record collection pages reuse snapshot directory paths across bounded reads and isolate returned values", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, { pageRecords: 1 });
  const writer = new PartitionTransactions(journal);
  for (let index = 0; index < 48; index += 1) {
    await commitFixtureTransaction(writer, {
      epoch: journal.head.epoch,
      sequence: index + 1,
      expectedGeneration: index,
      operationId: `seed-${index}`,
      input: {},
      mutations: [{ collection: "messages", key: key(index), owner: null, value: index }],
      result: null,
    });
  }
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const reader = new PartitionTransactions(reopened);
  await reopened.usingSnapshot(async (snapshot) => {
    assert.ok(snapshot.entityDirectory.activeCollection.level > 0);
    await reader.withCollectionReader(snapshot, async (read) => {
      const select = (index) => read({ collection: "messages", keys: [key(index)] });
      const first = await select(0);
      first.get(key(0)).value = "caller edit";
      assert.equal((await select(47)).get(key(47)).value, 47);
      const { result, reads } = await observeDirectoryPageReads(() => select(0));
      assert.equal(result.get(key(0)).value, 0);
      assert.deepEqual(reads, []);
    });
    const { result, reads } = await observeDirectoryPageReads(() =>
      reader.withCollectionReader(snapshot, (read) =>
        read({ collection: "messages", keys: [key(0)] }),
      ),
    );
    assert.equal(result.get(key(0)).value, 0);
    assert.deepEqual(
      reads,
      [],
      "bounded reads share validated directory paths in the same snapshot",
    );
  });
});
