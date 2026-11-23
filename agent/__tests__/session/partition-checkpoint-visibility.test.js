/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { PartitionSessionMessages } from "../../src/session/partition-storage/partition-session-messages.js";
import {
  commitFixtureTransaction,
  createTransactionCase,
} from "../helpers/partition-journal-cases.js";
import { initializePartitionSession } from "../helpers/partition-session-cases.js";
import { prepareFixtureContextTruncation } from "../helpers/partition-context-truncation.js";

const committedAt = "2026-11-20T00:00:00.000Z";

async function fixture(t, limits) {
  const result = await createTransactionCase(t, limits);
  const { journal, sessionId } = result;
  const scope = { sessionId, parentSessionId: "" };
  await initializePartitionSession(journal, scope, committedAt);
  return { ...result, scope, repository: new PartitionSessionMessages(journal, scope) };
}

function message(sessionId, messageUid, turnScopeId = "turn-1") {
  return {
    sessionId,
    messageUid,
    turnScopeId,
    dialogProcessId: "dialog-1",
    modelMessageId: `model-${messageUid}`,
    presentationMessageId: `presentation-${messageUid}`,
    role: "assistant",
    type: "message",
    content: messageUid,
    attachments: [],
    ts: committedAt,
  };
}

function checkpoint(sessionId, messageUid, checkpointId = "summary") {
  return {
    sessionId,
    turnScopeId: "turn-1",
    dialogProcessId: "dialog-1",
    userId: "admin",
    checkpointId,
    expectedCheckpointRevision: 0,
    messages: [],
    persistedMessageUids: [],
    summarizedMessageUids: [messageUid],
    retainedMessageUids: [],
  };
}

async function commit(journal, repository, operationId, changes) {
  const request = await journal.usingSnapshot((snapshot) =>
    repository.prepareRequest(snapshot, { operationId, committedAt, changes }),
  );
  return repository.commit(request);
}

async function truncate(journal, count) {
  const transactions = new PartitionTransactions(journal);
  await journal.usingSnapshot(async (snapshot) => {
    const current = (
      await transactions.lookupLatestMany({
        snapshot,
        collection: "metadata",
        keys: ["messageCount"],
      })
    ).get("messageCount");
    const mutations = [
      { collection: "metadata", key: "messageCount", owner: current.owner, value: count },
    ];
    await prepareFixtureContextTruncation(transactions, snapshot, count, mutations);
    await commitFixtureTransaction(transactions, {
      epoch: snapshot.epoch,
      expectedGeneration: snapshot.sequence,
      sequence: snapshot.sequence + 1,
      operationId: "truncate",
      input: {},
      mutations,
      result: null,
    });
  });
}

for (const reuse of [false, true]) {
  test(`checkpoint cannot summarize an invisible message after cold reopen (reuse=${reuse})`, async (t) => {
    const { journal, sessionId, root, scope, repository } = await fixture(t);
    await commit(journal, repository, "seed", { messages: [message(sessionId, "hidden")] });
    await truncate(journal, 0);
    if (reuse)
      await commit(journal, repository, "reuse", {
        messages: [message(sessionId, "new", "turn-2")],
      });
    await journal.close();
    const reopened = await PartitionJournal.open({ root, sessionId });
    t.after(() => reopened.close());
    const cold = new PartitionSessionMessages(reopened, scope);
    const before = reopened.head.sequence;
    await assert.rejects(
      commit(reopened, cold, "stale-checkpoint", {
        summaryCheckpoints: [checkpoint(sessionId, "hidden")],
      }),
      { code: "TURN_SUMMARY_CHECKPOINT_MESSAGE_MISSING" },
    );
    assert.equal(reopened.head.sequence, before);
    await reopened.usingSnapshot(async (snapshot) => {
      const stored = (
        await new PartitionTransactions(reopened).getLatestMany({
          snapshot,
          collection: "messages",
          keys: ["hidden"],
        })
      ).get("hidden");
      assert.notEqual(stored.value.message.summarized, true);
    });
  });
}

test("a checkpoint sees the session order staged by its own message creation", async (t) => {
  const { journal, sessionId, repository } = await fixture(t);
  const source = message(sessionId, "fresh");
  const result = await commit(journal, repository, "create-and-summarize", {
    messages: [source],
    summaryCheckpoints: [
      { ...checkpoint(sessionId, "fresh"), messages: [source], persistedMessageUids: ["fresh"] },
    ],
  });
  assert.equal(result.result.summaryCheckpoints[0].markedCount, 1);
});

test("a checkpoint validates and marks messages across partition query pages in one commit", async (t) => {
  const { journal, sessionId, repository } = await fixture(t, {
    pageRecords: 8,
    pageBytes: 256 * 1024,
    transactionBytes: 16 * 1024,
  });
  const sources = Array.from({ length: 10 }, (_, index) => message(sessionId, `source-${index}`));
  await commit(journal, repository, "seed-first", { messages: sources.slice(0, 5) });
  await commit(journal, repository, "seed-second", { messages: sources.slice(5) });
  const sourceUids = sources.map(({ messageUid }) => messageUid);
  const fresh = message(sessionId, "fresh");
  const summary = {
    ...checkpoint(sessionId, fresh.messageUid),
    messages: [fresh],
    persistedMessageUids: [fresh.messageUid],
    summarizedMessageUids: [...sourceUids, fresh.messageUid],
  };
  const changes = { messages: [fresh], summaryCheckpoints: [summary] };
  const before = journal.head.sequence;
  await assert.rejects(
    commit(journal, repository, "summary-missing", {
      ...changes,
      summaryCheckpoints: [
        {
          ...summary,
          summarizedMessageUids: [...summary.summarizedMessageUids, "missing"],
        },
      ],
    }),
    { code: "TURN_SUMMARY_CHECKPOINT_MESSAGE_MISSING" },
  );
  assert.equal(journal.head.sequence, before);
  const result = await commit(journal, repository, "summary", changes);
  const [committed] = result.result.summaryCheckpoints;
  assert.equal(journal.head.sequence, before + 1);
  assert.equal(committed.checkpointRevision, 1);
  assert.equal(committed.markedCount, sourceUids.length + 1);
  assert.deepEqual(committed.receipt.summarizedMessageUids, summary.summarizedMessageUids);
  assert.deepEqual(
    committed.messageReceipts.map(({ messageUid }) => messageUid),
    [fresh.messageUid],
  );
  const retry = await commit(journal, repository, "summary-retry", changes);
  const [replayed] = retry.result.summaryCheckpoints;
  assert.equal(journal.head.sequence, before + 1);
  assert.equal(replayed.deduplicated, true);
  assert.deepEqual(replayed.messageReceipts, committed.messageReceipts);
});

test("a second checkpoint preserves its head owner after cold reopen", async (t) => {
  const { journal, sessionId, repository, root, scope } = await fixture(t);
  await commit(journal, repository, "first", {
    messages: [message(sessionId, "first-message"), message(sessionId, "second-message")],
    summaryCheckpoints: [checkpoint(sessionId, "first-message", "first-summary")],
  });
  const readHead = (store) =>
    store.usingSnapshot(async (snapshot) => {
      const heads = await new PartitionTransactions(store).lookupLatestMany({
        snapshot,
        collection: "checkpointHeads",
        keys: ["turn-1"],
      });
      return heads.get("turn-1");
    });
  const first = await readHead(journal);
  await journal.close();
  const cold = await PartitionJournal.open({ root, sessionId });
  t.after(() => cold.close());
  const result = await commit(cold, new PartitionSessionMessages(cold, scope), "second", {
    summaryCheckpoints: [
      {
        ...checkpoint(sessionId, "second-message", "second-summary"),
        expectedCheckpointRevision: 1,
      },
    ],
  });
  assert.equal(result.result.summaryCheckpoints[0].checkpointRevision, 2);
  const second = await readHead(cold);
  assert.deepEqual(second.owner, first.owner);
  assert.notDeepEqual(second.reference, first.reference);
});

test("invisible checkpoint targets reject the whole request without publishing staged messages", async (t) => {
  const { journal, sessionId, repository } = await fixture(t);
  await commit(journal, repository, "seed", { messages: [message(sessionId, "hidden")] });
  await journal.usingSnapshot(async (oldSnapshot) => {
    await truncate(journal, 0);
    const before = journal.head.sequence;
    await assert.rejects(
      commit(journal, repository, "mixed", {
        messages: [message(sessionId, "unpublished", "turn-2")],
        summaryCheckpoints: [checkpoint(sessionId, "hidden")],
      }),
      { code: "TURN_SUMMARY_CHECKPOINT_MESSAGE_MISSING" },
    );
    assert.equal(journal.head.sequence, before);
    const page = await repository.readTurnPage({
      snapshot: oldSnapshot,
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
      cursor: null,
      limit: 1,
    });
    assert.equal(page.entries[0].message.messageUid, "hidden");
    assert.notEqual(page.entries[0].message.summarized, true);
    await journal.usingSnapshot(async (snapshot) => {
      assert.deepEqual(
        await repository.readSessionMessageOrderPage({ snapshot, cursor: null, limit: 1 }),
        {
          entries: [],
          nextCursor: null,
        },
      );
      const records = await new PartitionTransactions(journal).getLatestMany({
        snapshot,
        collection: "messages",
        keys: ["unpublished"],
      });
      assert.equal(records.get("unpublished"), null);
    });
  });
});

test("a new operation cannot replay a checkpoint for an invisible message", async (t) => {
  const { journal, sessionId, root, scope, repository } = await fixture(t);
  const summary = checkpoint(sessionId, "source");
  await commit(journal, repository, "seed", { messages: [message(sessionId, "source")] });
  const request = await journal.usingSnapshot((snapshot) =>
    repository.prepareRequest(snapshot, {
      operationId: "summarize",
      committedAt,
      changes: { summaryCheckpoints: [summary] },
    }),
  );
  const committed = await repository.commit(request);
  await truncate(journal, 0);
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const cold = new PartitionSessionMessages(reopened, scope);
  const before = reopened.head.sequence;

  assert.deepEqual(await cold.commit(request), { ...committed, replayed: true });
  await assert.rejects(commit(reopened, cold, "new-operation", { summaryCheckpoints: [summary] }), {
    code: "TURN_SUMMARY_CHECKPOINT_MESSAGE_MISSING",
  });
  assert.equal(reopened.head.sequence, before);
});
