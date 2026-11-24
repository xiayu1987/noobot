/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { createSessionJournalLease } from "@noobot/session-protocol/session-reader";
import { createPartitionSessionReaderAccess } from "../../src/session/partition-storage/partition-reader-access.js";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionSessionMessages } from "../../src/session/partition-storage/partition-session-messages.js";
import { PartitionSessionStateReader } from "../../src/session/partition-storage/partition-session-state-reader.js";
import { createScopedSessionArtifactReader } from "../../src/session/session-scoped-artifact-reader.js";
import { SessionPageSnapshots } from "../../src/session/session-page-snapshots.js";
import { TEST_STORAGE_SERVICE as storageService } from "../helpers/storage-service.js";
import { createTransactionCase } from "../helpers/partition-journal-cases.js";
import { bootstrap, message, prepare, scope } from "./partition-session-messages.test-helpers.js";

const parentSessionId = "owner";

async function fixture(t) {
  const { journal, root, sessionId } = await createTransactionCase(t, {
    transactionBytes: 16 * 1024,
    pageRecords: 1,
  });
  await bootstrap(journal, sessionId, parentSessionId);
  const current = { journal, active: 0 };
  const access = createPartitionSessionReaderAccess({
    withJournalRemoval: () => assert.fail("Unexpected journal removal"),
    acquireJournal(actual) {
      assert.equal(actual.sessionDir, root);
      assert.equal(actual.sessionId, sessionId);
      current.active += 1;
      return createSessionJournalLease({
        journal: current.journal,
        release: () => {
          current.active -= 1;
        },
      });
    },
  });
  const pageSnapshots = new SessionPageSnapshots();
  const deleted = new Set();
  t.after(() => pageSnapshots.close());
  const artifacts = createScopedSessionArtifactReader({
    storageService,
    sessionReaderAccess: access,
    pageSnapshots,
    withDeletionFence: (_userId, open) => open(),
    async assertAuthorityActive(_userId, id) {
      if (deleted.has(id)) throw Object.assign(new Error("deleted"), { code: "SESSION_DELETED" });
    },
  });
  const request = {
    userId: "user",
    authoritySessionId: "owner",
    sessionId,
    sessionDir: root,
    ...scope,
    cursor: null,
    limit: 1,
  };
  return { current, root, sessionId, request, artifacts, deleted, pageSnapshots };
}

test("scoped reads reject a deleted child even when its parent remains active", async (t) => {
  const { current, request, sessionId, artifacts, deleted, pageSnapshots } = await fixture(t);
  const messages = new PartitionSessionMessages(current.journal, { sessionId, parentSessionId });
  for (const uid of ["first", "second"]) {
    await messages.commit(
      await prepare(current.journal, messages, uid, {
        messages: [{ ...message(sessionId, uid), parentSessionId }],
      }),
    );
  }
  const { nextCursor } = await artifacts.readScopedThinkingDetail(request);
  assert.notEqual(nextCursor, null);
  assert.equal(current.active, 1);
  deleted.add(sessionId);
  await pageSnapshots.releaseDeletedSessions({
    userId: request.userId,
    sessionIds: deleted,
    directories: new Set(),
  });
  assert.equal(current.active, 0);
  await assert.rejects(artifacts.readScopedThinkingDetail({ ...request, cursor: nextCursor }), {
    code: "SESSION_PAGE_SNAPSHOT_EXPIRED",
  });
  await assert.rejects(artifacts.readScopedThinkingDetail(request), { code: "SESSION_DELETED" });
  await assert.rejects(artifacts.readScopedSessionSnapshot(request), { code: "SESSION_DELETED" });
  assert.equal(current.active, 0);
});

test("a scoped continuation rechecks deletion authority without local revocation", async (t) => {
  const { current, request, sessionId, artifacts, deleted } = await fixture(t);
  const messages = new PartitionSessionMessages(current.journal, { sessionId, parentSessionId });
  for (const uid of ["first", "second"]) {
    await messages.commit(
      await prepare(current.journal, messages, uid, {
        messages: [{ ...message(sessionId, uid), parentSessionId }],
      }),
    );
  }
  const { nextCursor } = await artifacts.readScopedThinkingDetail(request);
  assert.notEqual(nextCursor, null);
  assert.equal(current.active, 1);
  deleted.add(sessionId);
  await assert.rejects(artifacts.readScopedThinkingDetail({ ...request, cursor: nextCursor }), {
    code: "SESSION_DELETED",
  });
  assert.equal(current.active, 0);
  await assert.rejects(artifacts.readScopedThinkingDetail({ ...request, cursor: nextCursor }), {
    code: "SESSION_PAGE_SNAPSHOT_EXPIRED",
  });
});

test("scoped partition artifacts share authoritative identity, selective thinking pages and pinned lifetime", async (t) => {
  const { current, root, sessionId, request, artifacts } = await fixture(t);
  const messages = new PartitionSessionMessages(current.journal, { sessionId, parentSessionId });
  const makeMessage = (uid, fields) => ({
    ...message(sessionId, uid),
    parentSessionId,
    presentationMessageId: "presentation",
    ...fields,
  });
  const original = [
    makeMessage("answer", { content: "ordinary response" }),
    makeMessage("thinking-1", { content: "first reasoning", injectedMessage: true }),
    makeMessage("thinking-2", { content: "second reasoning", injectedMessage: true }),
  ];
  for (const entry of original)
    await messages.commit(
      await prepare(current.journal, messages, `seed-${entry.messageUid}`, { messages: [entry] }),
    );
  assert.deepEqual(
    await artifacts.readScopedThinkingDetail({ ...request, dialogProcessId: "foreign" }),
    { exists: false },
  );
  assert.equal(current.active, 0);

  const snapshot = await artifacts.readScopedSessionSnapshot({
    userId: "user",
    authoritySessionId: "owner",
    sessionDir: root,
  });
  assert.equal(snapshot.sessionSummary.sessionId, sessionId);
  assert.equal(current.active, 0);
  const before = await artifacts.readScopedThinkingDetail(request);
  assert.equal(before.sessionId, sessionId);
  assert.equal(before.messageCount, 3);
  assert.equal(before.messages[0].messageUid, "answer");
  assert.equal(current.active, 1);
  for (const wrong of [{ authoritySessionId: "another-parent" }, { sessionId: "another-child" }]) {
    await assert.rejects(artifacts.readScopedThinkingDetail({ ...request, ...wrong }), {
      code: "SESSION_NOT_FOUND",
    });
    const continuation = { ...request, cursor: before.nextCursor, ...wrong };
    await assert.rejects(artifacts.readScopedThinkingDetail(continuation), {
      code: "SESSION_PAGE_SNAPSHOT_EXPIRED",
    });
    await assert.rejects(artifacts.releaseScopedThinkingDetail(continuation), {
      code: "SESSION_PAGE_SNAPSHOT_EXPIRED",
    });
    assert.equal(current.active, 1);
  }
  await messages.commit(
    await prepare(current.journal, messages, "advance", {
      messages: [makeMessage("thinking-3", { content: "third reasoning", injectedMessage: true })],
    }),
  );
  const second = await artifacts.readScopedThinkingDetail({
    ...request,
    cursor: before.nextCursor,
  });
  assert.equal(second.messages[0].messageUid, "thinking-1");
  assert.equal(second.generation, before.generation);
  const resume = { ...request, cursor: second.nextCursor };
  const last = await artifacts.readScopedThinkingDetail(resume);
  assert.equal(last.messages[0].messageUid, "thinking-2");
  assert.equal(last.messageCount, 3);
  assert.equal(last.generation, before.generation);
  assert.equal(last.nextCursor, null);
  assert.equal(current.active, 0);
  await assert.rejects(artifacts.readScopedThinkingDetail(resume), {
    code: "SESSION_PAGE_SNAPSHOT_EXPIRED",
  });
  const readFresh = async () => {
    const first = await artifacts.readScopedThinkingDetail(request);
    assert.notEqual(first.generation, before.generation);
    assert.equal(first.messageCount, 4);
    let page = first;
    for (const [index, uid] of ["answer", "thinking-1", "thinking-2", "thinking-3"].entries()) {
      assert.equal(page.generation, first.generation);
      assert.equal(page.messages.length, 1);
      assert.equal(page.messages[0].messageUid, uid);
      if (index < 3) {
        assert.notEqual(page.nextCursor, null);
        page = await artifacts.readScopedThinkingDetail({ ...request, cursor: page.nextCursor });
      }
    }
    assert.equal(page.nextCursor, null);
    assert.equal(current.active, 0);
    return first.generation;
  };
  const generation = await readFresh();
  await current.journal.close();
  current.journal = await PartitionJournal.open({ root, sessionId });
  t.after(() => current.journal.close());
  assert.equal(await readFresh(), generation);
});

test("scoped display artifact pages distinguish an absent turn from an empty turn and release both leases", async (t) => {
  const { current, root, sessionId, artifacts } = await fixture(t);
  const messages = new PartitionSessionMessages(current.journal, { sessionId, parentSessionId });
  const read = () =>
    artifacts.readScopedDisplayArtifactPage({
      userId: "user",
      authoritySessionId: "owner",
      sessionDir: root,
      request: { sessionId, ...scope, cursor: null, limit: 1, maxBytes: 4096 },
    });
  assert.equal(await read(), null);
  assert.equal(current.active, 0);
  await messages.commit(
    await prepare(current.journal, messages, "answer", {
      messages: [{ ...message(sessionId, "answer"), parentSessionId }],
    }),
  );
  const page = await read();
  assert.equal(page.summary.status, "empty");
  assert.deepEqual(page.records, []);
  assert.equal(page.nextCursor, null);
  assert.equal(current.active, 0);
});

test("scoped partition thinking failures propagate and release the acquired journal", async (t) => {
  const { current, request, artifacts } = await fixture(t);
  const failure = new Error("thinking page unavailable");
  t.mock.method(PartitionSessionMessages.prototype, "readThinkingDetailPage", async () => {
    assert.equal(current.active, 1);
    throw failure;
  });
  await assert.rejects(artifacts.readScopedThinkingDetail(request), (error) => error === failure);
  assert.equal(current.active, 0);
});

test("scoped snapshot drains concurrent reads before releasing the journal on metadata failure", async (t) => {
  const { current, request, artifacts } = await fixture(t);
  const entered = Promise.withResolvers();
  const resume = Promise.withResolvers();
  const failed = Promise.withResolvers();
  t.after(() => resume.resolve());
  const failure = new Error("scoped metadata unavailable");
  const readOptionalJson = storageService.readOptionalJson.bind(storageService);
  t.mock.method(storageService, "readOptionalJson", async (file) => {
    entered.resolve();
    await resume.promise;
    assert.equal(current.active, 1);
    return readOptionalJson(file);
  });
  t.mock.method(PartitionSessionStateReader.prototype, "readScopedMetadata", async () => {
    await entered.promise;
    failed.resolve();
    throw failure;
  });
  let settled = false;
  const checked = assert
    .rejects(artifacts.readScopedSessionSnapshot(request), (error) => error === failure)
    .finally(() => {
      settled = true;
    });
  await Promise.race([
    failed.promise,
    checked.then(() => assert.fail("metadata failure was not reached")),
  ]);
  await setImmediate();
  try {
    assert.equal(settled, false);
    assert.equal(current.active, 1);
  } finally {
    resume.resolve();
  }
  await checked;
  assert.equal(current.active, 0);
});

test("scoped partition artifact access rejects conflicting authorities before acquiring a journal", async (t) => {
  const { current, root, artifacts } = await fixture(t);
  await writeFile(join(root, "head.json"), "{}");
  await assert.rejects(
    artifacts.readScopedSessionSnapshot({
      userId: "user",
      authoritySessionId: "owner",
      sessionDir: root,
    }),
    {
      code: "SESSION_STORAGE_CORRUPT",
    },
  );
  assert.equal(current.active, 0);
});
