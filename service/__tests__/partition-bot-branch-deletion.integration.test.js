/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { executeEmptySessionCleanup } from "../../agent/__tests__/helpers/session-services.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, stat } from "node:fs/promises";

import { SESSION_CALLER } from "@noobot/shared/session-caller";

import { SESSION_DELETION_STAGE } from "@noobot/workspace-protocol/session-tombstone";
import { attachScopeRoot } from "../../agent/src/artifacts/service/attachment-storage-layout.js";

import { express, registerSessionRoutes, withTestServer } from "./routes/session-routes.helpers.js";
import {
  createPartitionBotFixture,
  firstSend,
  identity,
} from "./partition-bot-assembly.test-helpers.js";

test("branch deletion without a cleanup executor rejects before recording a deletion", async (t) => {
  const { service } = await createPartitionBotFixture(t);
  const { bot } = await service.rebuildRuntimeConfig();
  await bot.session.applyTurnLifecycleEvent(firstSend());
  const { userId, sessionId } = identity;
  const repo = bot.sessionRuntime.repositories.sessionRepository;
  await assert.rejects(bot.session.deleteSessionBranch({ userId, sessionIds: [sessionId] }), {
    name: "TypeError",
    message: "branch deletion requires a cleanup executor",
  });
  assert.equal(await repo.isSessionDeleted(userId, sessionId), false);
  assert.deepEqual(await bot.session.listSessionIds({ userId }), [sessionId]);
});

test("deleting a partition tree session revokes and drains an in-flight display page", async (t) => {
  const { service } = await createPartitionBotFixture(t);
  const { bot } = await service.rebuildRuntimeConfig();
  await bot.session.applyTurnLifecycleEvent(firstSend());
  const { userId, sessionId } = identity;
  const request = { sessionId, cursor: null, limit: 1, maxBytes: 4096, direction: "backward" };
  const { nextCursor } = await bot.session.getSessionDisplayPage({ userId, request });
  assert.ok(nextCursor);
  const snapshots = bot.sessionRuntime.sessionCrudService.sessionRepo.pageSnapshots;
  assert.equal(snapshots.entries.size, 1);

  const pageRead = Promise.withResolvers();
  const resumePage = Promise.withResolvers();
  const revoking = Promise.withResolvers();
  const read = snapshots.read.bind(snapshots);
  const releaseDeletedSessions = snapshots.releaseDeletedSessions.bind(snapshots);
  t.mock.method(snapshots, "read", (options) =>
    read({
      ...options,
      async read(...args) {
        const page = await options.read(...args);
        pageRead.resolve(page);
        await resumePage.promise;
        return page;
      },
    }),
  );
  t.mock.method(snapshots, "releaseDeletedSessions", (selection) => {
    const release = releaseDeletedSessions(selection);
    revoking.resolve();
    return release;
  });
  const pending = bot.session.getSessionDisplayPage({
    userId,
    request: { ...request, cursor: nextCursor },
  });
  const rejected = assert.rejects(pending, { code: "SESSION_PAGE_SNAPSHOT_EXPIRED" });
  const lastPage = await Promise.race([pageRead.promise, pending]);
  const deleting = bot.session.deleteSessionBranch(
    { userId, sessionIds: [sessionId] },
    executeEmptySessionCleanup,
  );
  try {
    await Promise.race([revoking.promise, deleting]);
    assert.equal(lastPage.nextCursor, null);
    assert.equal(snapshots.entries.size, 1);
  } finally {
    resumePage.resolve();
  }
  const [deleted] = await Promise.all([deleting, rejected]);
  assert.deepEqual(deleted.deletedSessionIds, [sessionId]);
  assert.equal(snapshots.entries.size, 0);
  await assert.rejects(
    bot.session.getSessionDisplayPage({ userId, request: { ...request, cursor: nextCursor } }),
    { code: "SESSION_PAGE_SNAPSHOT_EXPIRED" },
  );
  await assert.rejects(bot.session.getSessionDisplayPage({ userId, request }), {
    code: "SESSION_DELETED",
  });
  assert.deepEqual(
    await bot.session.releaseSessionDisplayPage({
      userId,
      request: { sessionId, cursor: nextCursor },
    }),
    { released: false },
  );
});

for (const failedPhase of ["plugin", "attachment"]) {
  test(`branch cleanup resumes after ${failedPhase} failure and runtime rebuild`, async (t) => {
    const { service, access } = await createPartitionBotFixture(t);
    const { bot } = await service.rebuildRuntimeConfig();
    const { userId, sessionId: root } = identity;
    const child = "child";
    await bot.session.createSession({
      ...identity,
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });
    await bot.session.applyTurnLifecycleEvent({
      ...firstSend({ ...identity, sessionId: child }),
      parentSessionId: root,
    });
    const calls = [];
    const cause = new Error(`interrupted ${failedPhase} cleanup`);
    let injected = false;
    if (failedPhase === "attachment") {
      t.mock.method(bot, "deleteScopedAttachmentsBySessionIds", async () => {
        injected = true;
        throw cause;
      });
    }
    const app = express();
    registerSessionRoutes(app, {
      bot: access,
      runBotOperation: access.runOperation,
      pluginHost: {
        listSessionDeletionHandlers: () => ["fixture"],
        async emitAfterSessionDelete({ deletedSessionIds }) {
          calls.push(deletedSessionIds);
          if (failedPhase === "plugin" && calls.length === 1) {
            injected = true;
            throw cause;
          }
        },
      },
      translateText: (key) => key,
    });
    await withTestServer(app, async (baseUrl) => {
      const url = `${baseUrl}/internal/session/${userId}/${root}`;
      const first = await fetch(url, { method: "DELETE" });
      assert.equal(first.status, 500);
      await first.json();
      assert.equal(injected, true);
      assert.deepEqual(calls, [[root, child]]);
      assert.deepEqual(await bot.session.listSessionIds({ userId }), []);
      const { bot: reopened } = await service.rebuildRuntimeConfig();
      assert.notEqual(reopened, bot);
      const retry = await fetch(url, { method: "DELETE" });
      const payload = await retry.json();
      assert.equal(retry.status, 200, JSON.stringify(payload));
      assert.deepEqual(payload.deletedSessionIds, [root, child]);
      const replay = await fetch(url, { method: "DELETE" });
      assert.equal(replay.status, 200);
      assert.deepEqual(await replay.json(), payload);
      assert.deepEqual(
        calls,
        failedPhase === "plugin"
          ? [
              [root, child],
              [root, child],
            ]
          : [[root, child]],
      );
    });
  });
}

test("branch cleanup safely replays attachment deletion when its checkpoint fails", async (t) => {
  const { service, access } = await createPartitionBotFixture(t);
  const { bot } = await service.rebuildRuntimeConfig();
  const { userId, sessionId } = identity;
  const retainedId = "retained";
  await bot.session.applyTurnLifecycleEvent(firstSend());
  await bot.session.applyTurnLifecycleEvent(firstSend({ ...identity, sessionId: retainedId }));
  const attachmentDir = (id) =>
    attachScopeRoot(bot.getWorkspacePath(userId), { sessionId: id, attachmentSource: "model" });
  await mkdir(attachmentDir(sessionId), { recursive: true });
  await mkdir(attachmentDir(retainedId), { recursive: true });
  const repo = bot.sessionRuntime.repositories.sessionRepository;
  const advance = repo.advanceSessionBranchDeletion.bind(repo);
  let interrupted = false;
  t.mock.method(repo, "advanceSessionBranchDeletion", async (user, key, completedStage) => {
    if (completedStage === SESSION_DELETION_STAGE.ATTACHMENTS) {
      interrupted = true;
      throw new Error("attachment cleanup completed, checkpoint not written");
    }
    return advance(user, key, completedStage);
  });
  let pluginCalls = 0;
  const app = express();
  app.use(express.json());
  registerSessionRoutes(app, {
    bot: access,
    runBotOperation: access.runOperation,
    pluginHost: {
      listSessionDeletionHandlers: () => ["fixture"],
      async emitAfterSessionDelete() {
        pluginCalls++;
      },
    },
    translateText: (key) => key,
  });
  await withTestServer(app, async (baseUrl) => {
    const url = `${baseUrl}/internal/session/${userId}/${sessionId}`;
    const first = await fetch(url, { method: "DELETE" });
    const failure = await first.json();
    assert.equal(first.status, 500, JSON.stringify(failure));
    assert.equal(interrupted, true, JSON.stringify(failure));
    await assert.rejects(stat(attachmentDir(sessionId)), { code: "ENOENT" });
    assert.deepEqual(
      await bot.attach.readAttachmentMetas({
        userId,
        sessionId,
        attachmentSource: "model",
      }),
      [],
    );
    await assert.rejects(stat(attachmentDir(sessionId)), { code: "ENOENT" });
    await assert.rejects(
      bot.attach.ingestGeneratedArtifacts({
        userId,
        sessionId,
        artifacts: [{ name: "late.txt", contentBase64: "bGF0ZQ==" }],
      }),
      { code: "SESSION_DELETED" },
    );
    const { bot: reopened } = await service.rebuildRuntimeConfig();
    const overlapping = await fetch(`${baseUrl}/internal/sessions/${userId}/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionIds: [retainedId, sessionId] }),
    });
    assert.equal((await overlapping.json()).errorCode, "SESSION_DELETED");
    assert.deepEqual(await reopened.session.listSessionIds({ userId }), [retainedId]);
    const replayCleanup = t.mock.method(reopened, "deleteScopedAttachmentsBySessionIds");
    const retry = await fetch(url, { method: "DELETE" });
    assert.equal(retry.status, 200);
    assert.deepEqual((await retry.json()).deletedSessionIds, [sessionId]);
    assert.equal(replayCleanup.mock.callCount(), 1);
    assert.equal(pluginCalls, 1);
    await stat(attachmentDir(retainedId));
  });
});
