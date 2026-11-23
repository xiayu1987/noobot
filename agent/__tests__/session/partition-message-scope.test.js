/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { PARTITION_SESSION_METADATA } from "@noobot/session-protocol/partition-transaction";
import { PartitionSessionMessages } from "../../src/session/partition-storage/partition-session-messages.js";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { createTransactionCase } from "../helpers/partition-journal-cases.js";
import {
  committedAt,
  scope,
  message,
  prepare,
  openTestMessages,
  bootstrap,
  createMessageCase,
} from "./partition-session-messages.test-helpers.js";

test("persisted message scope gates writes, retained receipts and both page types", async (t) => {
  const { journal, sessionId, root } = await createTransactionCase(t, { batchWaitMs: 20 });
  const parentSessionId = "parent-1";
  const initialized = await bootstrap(journal, sessionId, parentSessionId);
  const repository = new PartitionSessionMessages(journal, { sessionId, parentSessionId });
  const wrongParent = new PartitionSessionMessages(journal, {
    sessionId,
    parentSessionId: "parent-2",
  });
  const wrongSession = new PartitionSessionMessages(journal, {
    sessionId: "other-session",
    parentSessionId,
  });
  const changes = { messages: [{ ...message(sessionId, "m1"), parentSessionId }] };
  const request = await prepare(journal, repository, "create", {
    ...changes,
    sessionMetadata: { customTitle: "Mixed commit" },
  });
  const mixed = await prepare(journal, repository, "mixed", {
    messages: [{ ...message(sessionId, "invalid-mixed"), parentSessionId }],
    sessionMetadata: {},
  });
  const empty = await prepare(journal, repository, "empty", { messages: [] });
  const foreignMessage = await prepare(journal, repository, "foreign-message", {
    messages: [{ ...message(sessionId, "m2"), parentSessionId: "parent-2" }],
  });
  const scopeError = { code: "SESSION_SCOPE_IDENTITY_CONFLICT", statusCode: 409 };
  const before = journal.work.publications;
  await assert.rejects(repository.commit(foreignMessage), {
    code: "SESSION_MESSAGE_IDENTITY_CONFLICT",
  });
  assert.equal(journal.work.publications, before);
  const rejected = [
    assert.rejects(wrongParent.commit(mixed), scopeError),
    assert.rejects(wrongSession.commit(request), scopeError),
    assert.rejects(repository.commit(mixed), { code: "SESSION_COMMIT_INPUT_INVALID" }),
    assert.rejects(repository.commit(empty), { code: "SESSION_COMMIT_INPUT_INVALID" }),
  ];
  const [committed] = await Promise.all([repository.commit(request), ...rejected]);
  assert.equal(journal.work.publications, before + 1);
  await assert.rejects(wrongParent.commit(request), scopeError);
  await assert.rejects(wrongSession.commit(request), scopeError);
  await assert.rejects(repository.commit(mixed), { code: "SESSION_OPERATION_CONFLICT" });
  await journal.usingSnapshot(async (snapshot) => {
    const page = { snapshot, ...scope, cursor: null, limit: 1 };
    const [{ messageUid, contentReference }] = committed.result.messageReceipts;
    const content = { ...page, messageUid, contentReference };
    for (const foreign of [wrongParent, wrongSession]) {
      await assert.rejects(foreign.readTurnPage(page), scopeError);
      await assert.rejects(foreign.readContentPage(content), scopeError);
    }
    assert.equal((await repository.readTurnPage(page)).entries[0].message.messageUid, messageUid);
    assert.deepEqual((await repository.readContentPage(content)).entries, ["m1"]);
  });
  assert.equal(journal.work.publications, before + 1);
  const currentPath = join(root, "CURRENT");
  const published = await readFile(currentPath);
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const foreign = new PartitionSessionMessages(reopened, {
    sessionId,
    parentSessionId: "parent-2",
  });
  const authorized = new PartitionSessionMessages(reopened, { sessionId, parentSessionId });
  await reopened.usingSnapshot(async (snapshot) => {
    const { collection, key } = PARTITION_SESSION_METADATA;
    const values = await new PartitionTransactions(reopened).getLatestMany({
      snapshot,
      collection,
      keys: [key],
    });
    assert.deepEqual(values.get(key).value, {
      ...initialized.result.metadata,
      customTitle: "Mixed commit",
      updatedAt: committedAt,
    });
    const page = await authorized.readTurnPage({ snapshot, ...scope, cursor: null, limit: 2 });
    assert.deepEqual(
      page.entries.map(({ message }) => message.messageUid),
      ["m1"],
    );
  });
  await assert.rejects(foreign.commit(request), scopeError);
  assert.deepEqual(await readFile(currentPath), published);
  const originalKeys = Object.keys;
  const guard = t.mock.method(Object, "keys", (value) => {
    assert.ok(!new Error().stack.includes("at requirePartitionMessageChanges"));
    return originalKeys(value);
  });
  try {
    assert.deepEqual(await authorized.commit(request), { ...committed, replayed: true });
  } finally {
    guard.mock.restore();
  }
  assert.deepEqual(await readFile(currentPath), published);
});

test("an uninitialized session cannot borrow scope from the same batch", async (t) => {
  const { journal, sessionId } = await createTransactionCase(
    t,
    { batchWaitMs: 20 },
    { autoClose: false },
  );
  assert.throws(() => new PartitionSessionMessages(journal), TypeError);
  const repository = openTestMessages(journal, sessionId);
  const request = await prepare(journal, repository, "create", {
    messages: [message(sessionId, "m1")],
  });
  const before = journal.work.publications;
  const corrupt = { code: "SESSION_STORAGE_CORRUPT" };
  await journal.usingSnapshot((snapshot) =>
    assert.rejects(
      repository.readTurnPage({ snapshot, ...scope, cursor: null, limit: 1 }),
      corrupt,
    ),
  );
  await Promise.all([
    assert.rejects(bootstrap(journal, sessionId, ""), corrupt),
    assert.rejects(repository.commit({ ...request, expectedGeneration: 1 }), corrupt),
  ]);
  await assert.rejects(journal.close(), corrupt);
  assert.equal(journal.work.publications, before);
});

test("unexpected message normalization failure cancels the whole unpublished batch", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(
    t,
    { batchWaitMs: 20 },
    { autoClose: false },
  );
  const repository = openTestMessages(journal, sessionId);
  const good = await prepare(journal, repository, "good", { messages: [message(sessionId, "m1")] });
  const bad = await prepare(journal, repository, "bad", {
    messages: [{ ...message(sessionId, "m2"), transferEnvelopes: [{}] }],
  });
  const current = join(root, "CURRENT");
  const published = await readFile(current);
  const { writeBytes, controlWriteBytes, publications } = journal.work;
  const plan = t.mock.method(journal, "planPublication");
  const failure = new TypeError("unexpected transfer normalization failure");
  const entries = Object.entries;
  const outcomes = await (async () => {
    const mock = t.mock.method(Object, "entries", (value) => {
      if (new Error().stack.includes("at assertNoPaths")) throw failure;
      return entries(value);
    });
    try {
      return await Promise.allSettled([
        repository.commit(good),
        repository.commit({ ...bad, expectedGeneration: good.expectedGeneration + 1 }),
      ]);
    } finally {
      mock.mock.restore();
    }
  })();
  const closed = await Promise.allSettled([journal.close()]);
  for (const outcome of [...outcomes, ...closed]) {
    assert.equal(outcome.status, "rejected");
    assert.equal(outcome.reason, failure);
  }
  assert.equal(plan.mock.callCount(), 1);
  assert.equal(journal.work.writeBytes, writeBytes);
  assert.equal(journal.work.controlWriteBytes, controlWriteBytes);
  assert.equal(journal.work.publications, publications);
  assert.deepEqual(await readFile(current), published);
});
