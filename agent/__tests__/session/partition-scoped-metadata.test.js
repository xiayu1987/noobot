/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PARTITION_SCOPED_METADATA } from "@noobot/session-protocol/partition-session-state";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { openPartitionSessionReader } from "../../src/session/partition-storage/partition-session-reader.js";
import { commitFixtureTransaction } from "../helpers/partition-journal-cases.js";
import {
  createMessageCase,
  openTestMessages,
  prepare,
  message,
  scope,
} from "./partition-session-messages.test-helpers.js";

const options = (journal, sessionId) => ({ journal, sessionId, parentSessionId: "" });

test("scoped metadata commits atomically with settings, isolates objects and snapshots, replays and reopens", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t);
  const repository = openTestMessages(journal, sessionId);
  await using old = await openPartitionSessionReader(options(journal, sessionId));
  assert.equal(await old.readScopedMetadata(), null);
  const value = { workflow: { revision: 1 } };
  const request = await prepare(journal, repository, "scoped", {
    scopedMetadata: value,
    sessionMetadata: { customTitle: "same transaction" },
  });
  value.workflow.revision = 99;
  const result = await repository.commit(request);
  assert.equal(
    result.mutations.filter(({ collection, key }) => collection === "metadata" && key === "scoped")
      .length,
    1,
  );
  assert.equal(await old.readScopedMetadata(), null);
  {
    await using current = await openPartitionSessionReader(options(journal, sessionId));
    assert.equal((await current.readMetadata()).customTitle, "same transaction");
    const read = await current.readScopedMetadata();
    assert.deepEqual(read, { workflow: { revision: 1 } });
    read.workflow.revision = 100;
    assert.deepEqual(await current.readScopedMetadata(), { workflow: { revision: 1 } });
  }
  const head = journal.head;
  assert.deepEqual(await repository.commit(request), { ...result, replayed: true });
  assert.deepEqual(journal.head, head);
  await old[Symbol.asyncDispose]();
  await journal.close();
  const cold = await PartitionJournal.open({ root, sessionId });
  t.after(() => cold.close());
  await using reopened = await openPartitionSessionReader(options(cold, sessionId));
  assert.deepEqual(await reopened.readScopedMetadata(), { workflow: { revision: 1 } });
  assert.deepEqual(await openTestMessages(cold, sessionId).commit(request), {
    ...result,
    replayed: true,
  });
});

test("scoped-only updates and an empty object replace the previous authority", async (t) => {
  const { journal, sessionId } = await createMessageCase(t);
  const repository = openTestMessages(journal, sessionId);
  for (const [index, value] of [{ workflow: { active: true } }, {}].entries()) {
    await repository.commit(
      await prepare(journal, repository, `update-${index}`, { scopedMetadata: value }),
    );
    await using reader = await openPartitionSessionReader(options(journal, sessionId));
    assert.deepEqual(await reader.readScopedMetadata(), value);
  }
});

test("a replayed checkpoint does not discard a scoped metadata update", async (t) => {
  const { journal, sessionId } = await createMessageCase(t, { transactionBytes: 16 * 1024 });
  const repository = openTestMessages(journal, sessionId);
  await repository.commit(
    await prepare(journal, repository, "source", { messages: [message(sessionId, "source")] }),
  );
  const checkpoint = {
    ...scope,
    sessionId,
    userId: "admin",
    checkpointId: "checkpoint",
    expectedCheckpointRevision: 0,
    messages: [],
    persistedMessageUids: [],
    summarizedMessageUids: ["source"],
    retainedMessageUids: [],
  };
  await repository.commit(
    await prepare(journal, repository, "checkpoint", { summaryCheckpoints: [checkpoint] }),
  );
  await repository.commit(
    await prepare(journal, repository, "checkpoint-and-scoped", {
      summaryCheckpoints: [checkpoint],
      scopedMetadata: { revision: 2 },
    }),
  );
  await using reader = await openPartitionSessionReader(options(journal, sessionId));
  assert.deepEqual(await reader.readScopedMetadata(), { revision: 2 });
  assert.equal((await reader.readCheckpointState(scope.turnScopeId)).receipts.length, 1);
});

for (const value of [undefined, { version: 2, value: {} }]) {
  test(`missing or malformed scoped authority rejects reads and updates (${JSON.stringify(value)})`, async (t) => {
    const { journal, sessionId } = await createMessageCase(t, {}, { autoClose: false });
    const transactions = new PartitionTransactions(journal);
    const stored = await journal.usingSnapshot(async (snapshot) =>
      (
        await transactions.lookupLatestMany({ snapshot, collection: "metadata", keys: ["scoped"] })
      ).get("scoped"),
    );
    await commitFixtureTransaction(transactions, {
      epoch: journal.head.epoch,
      expectedGeneration: journal.head.sequence,
      sequence: journal.head.sequence + 1,
      operationId: "damage-scoped",
      input: {},
      mutations: [
        {
          ...PARTITION_SCOPED_METADATA,
          owner: stored.owner,
          ...(value === undefined ? { remove: true } : { value }),
        },
      ],
      result: null,
    });
    await using reader = await openPartitionSessionReader(options(journal, sessionId));
    await assert.rejects(reader.readScopedMetadata(), { code: "SESSION_STORAGE_CORRUPT" });
    const repository = openTestMessages(journal, sessionId);
    const head = journal.head;
    await assert.rejects(
      repository.commit(await prepare(journal, repository, "overwrite", { scopedMetadata: {} })),
      { code: "SESSION_STORAGE_CORRUPT" },
    );
    assert.deepEqual(journal.head, head);
    await reader[Symbol.asyncDispose]();
    await assert.rejects(journal.close(), { code: "SESSION_STORAGE_CORRUPT" });
  });
}
