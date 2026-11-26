/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { filePath as path } from "@noobot/path-resolver";
import { messageDiagnosticKey } from "@noobot/session-protocol/session-changes";
import { emptyPartitionSession } from "../helpers/partition-session-cases.js";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { PartitionSessionTransactions } from "../../src/session/partition-storage/partition-session-transactions.js";
import { PartitionSessionMessages } from "../../src/session/partition-storage/partition-session-messages.js";
import { preparePartitionMessageDiagnostics } from "../../src/session/partition-storage/partition-message-diagnostics.js";
import { getFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import {
  commitFixtureTransaction,
  createTransactionCase,
} from "../helpers/partition-journal-cases.js";

const committedAt = "2026-11-20T00:00:00.000Z";
const parentSessionId = "parent";

function open(journal) {
  return new PartitionSessionMessages(journal, {
    sessionId: journal.head.sessionId,
    parentSessionId,
  });
}

async function fixture(t, options) {
  const context = await createTransactionCase(t, { transactionBytes: 16 * 1024 }, options);
  const { journal, sessionId } = context;
  const transactions = new PartitionSessionTransactions(journal, { sessionId, parentSessionId });
  const request = await journal.usingSnapshot((snapshot) =>
    transactions.prepareInitialization(snapshot, {
      operationId: "bootstrap",
      scopedMetadata: null,
      session: emptyPartitionSession({ sessionId, parentSessionId, committedAt }),
    }),
  );
  await transactions.initialize(request);
  return { ...context, repository: open(journal) };
}

function changes(sessionId, ids, dialogProcessId = "dialog-1") {
  const messages = ids.map((messageUid) => ({
    sessionId,
    parentSessionId,
    dialogProcessId,
    turnScopeId: `turn-${dialogProcessId}`,
    messageUid,
    modelMessageId: `model-${messageUid}`,
    presentationMessageId: `presentation-${messageUid}`,
    role: "assistant",
    type: "message",
    content: `body-${messageUid}`,
    attachments: [],
    ts: committedAt,
  }));
  return {
    messages,
    messageDiagnostics: messages.map((message) => ({
      messageUid: message.messageUid,
      record: {
        userId: "u1",
        sessionId,
        dialogProcessId,
        turnScopeId: message.turnScopeId,
        event: "session_turn_full",
        category: "diagnostic",
        type: "session_turn",
        ts: committedAt,
        data: { artifactRef: { source: "session.messages", messageUid: message.messageUid } },
      },
    })),
  };
}

function prepare(journal, repository, operationId, delta) {
  return journal.usingSnapshot((snapshot) =>
    repository.prepareRequest(snapshot, { operationId, committedAt, changes: delta }),
  );
}

function page(journal, repository, options = {}) {
  return journal.usingSnapshot((snapshot) =>
    repository.readMessageDiagnosticPage({ snapshot, after: 0, limit: 8, ...options }),
  );
}

function uids(result) {
  return result.entries.map(({ record }) => record.data.artifactRef.messageUid);
}

test("partition diagnostics commit with messages, retain snapshots and replay once after reopen", async (t) => {
  const { journal, repository, sessionId, root } = await fixture(t);
  const first = await prepare(journal, repository, "first", changes(sessionId, ["a", "b"]));
  const result = await repository.commit(first);
  await journal.usingSnapshot(async (snapshot) => {
    await repository.commit(
      await prepare(journal, repository, "second", changes(sessionId, ["c"], "dialog-2")),
    );
    const retained = await repository.readMessageDiagnosticPage({ snapshot, after: 0, limit: 8 });
    assert.deepEqual(uids(retained), ["a", "b"]);
    assert.equal(retained.sequence, 2);
    assert.equal(retained.pending, false);
  });
  const firstPage = await page(journal, repository, { limit: 1 });
  assert.deepEqual(uids(firstPage), ["a"]);
  assert.equal(firstPage.pending, true);
  const rest = await page(journal, repository, { after: firstPage.sequence });
  assert.deepEqual(uids(rest), ["b", "c"]);
  const dialog = await page(journal, repository, { dialogProcessId: "dialog-2" });
  assert.deepEqual(uids(dialog), ["c"]);
  assert.equal(dialog.sequence, 1);
  assert.equal(dialog.entries[0].sourceId, rest.entries[1].sourceId);
  assert.equal(dialog.entries[0].record.parentSessionId, parentSessionId);
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const reader = open(reopened);
  const before = await readFile(`${root}/CURRENT`);
  assert.deepEqual(await reader.commit(first), { ...result, replayed: true });
  assert.deepEqual(await readFile(`${root}/CURRENT`), before);
  assert.deepEqual(uids(await page(reopened, reader)), ["a", "b", "c"]);
});

test("cold checkpoint retry skips its diagnostics while mixed work publishes new sources", async (t) => {
  const { journal, repository, sessionId, root } = await fixture(t);
  const delta = changes(sessionId, ["a"]);
  const message = delta.messages[0];
  delta.summaryCheckpoints = [
    {
      sessionId,
      userId: "u1",
      dialogProcessId: message.dialogProcessId,
      turnScopeId: message.turnScopeId,
      checkpointId: "checkpoint",
      expectedCheckpointRevision: 0,
      messages: [message],
      persistedMessageUids: [message.messageUid],
      summarizedMessageUids: [message.messageUid],
      retainedMessageUids: [],
    },
  ];
  const committed = await repository.commit(
    await prepare(journal, repository, "checkpoint", delta),
  );
  const { messageReceipts } = committed.result.summaryCheckpoints[0];
  assert.deepEqual(
    messageReceipts.map(({ messageUid }) => messageUid),
    [message.messageUid],
  );
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const cold = open(reopened);
  const before = await readFile(`${root}/CURRENT`);
  const retry = await cold.commit(await prepare(reopened, cold, "checkpoint-new-operation", delta));
  assert.equal(retry.result.summaryCheckpoints[0].deduplicated, true);
  assert.deepEqual(retry.result.summaryCheckpoints[0].messageReceipts, messageReceipts);
  assert.deepEqual(await readFile(`${root}/CURRENT`), before);
  const fresh = changes(sessionId, ["b"], "dialog-2");
  const mixed = await cold.commit(
    await prepare(reopened, cold, "mixed", {
      messages: [...delta.messages, ...fresh.messages],
      messageDiagnostics: [...delta.messageDiagnostics, ...fresh.messageDiagnostics],
      summaryCheckpoints: delta.summaryCheckpoints,
    }),
  );
  assert.deepEqual(mixed.result.summaryCheckpoints[0].messageReceipts, messageReceipts);
  assert.deepEqual(uids(await page(reopened, cold)), ["a", "b"]);
});

test("diagnostic validation isolates a rejected request between accepted batch requests", async (t) => {
  const { journal, repository, sessionId } = await fixture(t);
  const first = await prepare(journal, repository, "first", changes(sessionId, ["a"]));
  const bad = await prepare(journal, repository, "bad", changes(sessionId, ["bad"]));
  const healthy = await prepare(journal, repository, "healthy", changes(sessionId, ["b"]));
  const invalid = structuredClone(bad);
  invalid.expectedGeneration = first.expectedGeneration + 1;
  invalid.input.changes.messageDiagnostics[0].record.dialogProcessId = "foreign";
  const results = await Promise.allSettled([
    repository.commit(first),
    repository.commit(invalid),
    repository.commit({ ...healthy, expectedGeneration: first.expectedGeneration + 1 }),
  ]);
  assert.deepEqual(
    results.map(({ status }) => status),
    ["fulfilled", "rejected", "fulfilled"],
    results.map(({ reason }) => reason?.stack).join("\n"),
  );
  assert.equal(results[1].reason.code, "SESSION_COMMIT_INPUT_INVALID");
  assert.deepEqual(uids(await page(journal, repository)), ["a", "b"]);
  await journal.usingSnapshot(async (snapshot) => {
    const order = await repository.readSessionMessageOrderPage({
      snapshot,
      cursor: null,
      limit: 8,
    });
    assert.deepEqual(order.entries, ["a", "b"]);
  });
});

test("publication failure exposes neither message nor diagnostic and exact retry commits both", async (t) => {
  const { journal, repository, sessionId, root } = await fixture(t, { autoClose: false });
  const request = await prepare(journal, repository, "failed", changes(sessionId, ["a"]));
  const previous = getFsAdapter();
  const current = path.join(root, "CURRENT");
  const before = await readFile(current);
  let failed = false;
  setFsAdapter({
    ...previous,
    async rename(source, destination) {
      if (String(destination) === current && !failed) {
        failed = true;
        throw new Error("diagnostic publication fault");
      }
      return previous.rename(source, destination);
    },
  });
  try {
    await assert.rejects(repository.commit(request), (error) => {
      assert.equal(error.code, "SESSION_COMMIT_UNCERTAIN");
      assert.equal(error.cause.message, "diagnostic publication fault");
      return true;
    });
  } finally {
    setFsAdapter(previous);
  }
  assert.equal(failed, true);
  assert.deepEqual(await readFile(current), before);
  assert.deepEqual(uids(await page(journal, repository)), []);
  await assert.rejects(journal.close(), { code: "SESSION_COMMIT_UNCERTAIN" });
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const reader = open(reopened);
  assert.deepEqual(uids(await page(reopened, reader)), []);
  assert.equal((await reader.commit(request)).replayed, false);
  assert.deepEqual(uids(await page(reopened, reader)), ["a"]);
});

test("diagnostic reads enforce persisted scope and collection budgets", async (t) => {
  const { journal, repository, sessionId } = await fixture(t);
  await repository.commit(await prepare(journal, repository, "source", changes(sessionId, ["a"])));
  const foreign = new PartitionSessionMessages(journal, { sessionId, parentSessionId: "foreign" });
  await assert.rejects(page(journal, foreign), { code: "SESSION_SCOPE_IDENTITY_CONFLICT" });
  await assert.rejects(page(journal, repository, { after: 2 }), {
    code: "SESSION_STORAGE_CORRUPT",
  });
  await assert.rejects(page(journal, repository, { limit: Number.MAX_SAFE_INTEGER }), {
    code: "SESSION_QUERY_BUDGET",
  });
  await assert.rejects(page(journal, repository, { limit: 1.5 }), TypeError);
});

test("invalid persisted diagnostic heads fail the entire unpublished batch", async (t) => {
  const { journal, repository, sessionId, root } = await fixture(t, { autoClose: false });
  await commitFixtureTransaction(new PartitionTransactions(journal), {
    epoch: journal.head.epoch,
    expectedGeneration: 1,
    sequence: 2,
    operationId: "corrupt-head",
    input: {},
    result: null,
    mutations: [
      {
        collection: "messageDiagnostics",
        key: "head",
        owner: null,
        value: { version: 1, sequence: 0 },
      },
    ],
  });
  const before = await readFile(`${root}/CURRENT`);
  const request = await prepare(journal, repository, "source", changes(sessionId, ["a"]));
  await assert.rejects(repository.commit(request), { code: "SESSION_STORAGE_CORRUPT" });
  assert.deepEqual(await readFile(`${root}/CURRENT`), before);
  await assert.rejects(page(journal, repository), { code: "SESSION_STORAGE_CORRUPT" });
  await assert.rejects(journal.close(), { code: "SESSION_STORAGE_CORRUPT" });
});

test("missing indexed diagnostic bodies are corruption rather than an empty page", async (t) => {
  const { journal, repository, sessionId } = await fixture(t);
  await repository.commit(await prepare(journal, repository, "source", changes(sessionId, ["a"])));
  const transactions = new PartitionTransactions(journal);
  const entry = await journal.usingSnapshot(async (snapshot) =>
    (
      await transactions.lookupLatestMany({
        snapshot,
        collection: "messageDiagnostics",
        keys: [messageDiagnosticKey(1)],
      })
    ).get(messageDiagnosticKey(1)),
  );
  await commitFixtureTransaction(transactions, {
    epoch: journal.head.epoch,
    expectedGeneration: 2,
    sequence: 3,
    operationId: "remove-body",
    input: {},
    result: null,
    mutations: [
      {
        collection: "messageDiagnostics",
        key: messageDiagnosticKey(1),
        owner: entry.owner,
        remove: true,
      },
    ],
  });
  await assert.rejects(page(journal, repository), { code: "SESSION_STORAGE_CORRUPT" });
});

test("disabled diagnostics allocate no collection reads or mutations", () => {
  const mutations = [];
  assert.equal(
    preparePartitionMessageDiagnostics(
      { getLatestMany: () => assert.fail("unused") },
      mutations,
      [],
    ),
    undefined,
  );
  assert.deepEqual(mutations, []);
});
