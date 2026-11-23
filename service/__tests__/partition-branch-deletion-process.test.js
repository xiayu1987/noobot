/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { stat } from "node:fs/promises";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT_ENV } from "@noobot/runtime-topology-protocol/workspace-root";
import {
  SESSION_DELETION_STAGE as STAGE,
  sessionBranchDeletionKey,
} from "@noobot/workspace-protocol/session-tombstone";
import { attachScopeRoot } from "../../agent/src/artifacts/service/attachment-storage-layout.js";
import {
  createPartitionBotFixture,
  firstSend,
  identity,
} from "./partition-bot-assembly.test-helpers.js";

const fixture = new URL("./partition-bot-assembly.test-helpers.js", import.meta.url);
const layout = new URL(
  "../../agent/src/artifacts/service/attachment-storage-layout.js",
  import.meta.url,
);
const deleteSource = `
  import assert from "node:assert/strict";
  import { flushRuntimeEvents } from "@noobot/runtime-events";
  import { createPartitionBotRuntime, identity } from ${JSON.stringify(fixture.href)};
  import { createDeletionHttpFixture } from ${JSON.stringify(new URL("./partition-session-deletion-crash.test-helpers.js", import.meta.url).href)};
  import { registerSessionRoutes, withTestServer } from ${JSON.stringify(new URL("./routes/session-routes.helpers.js", import.meta.url).href)};
  const cleanup = [];
  const t = { after: (fn) => cleanup.push(fn) };
  const { service, access } = createPartitionBotRuntime(t, { workspaceRoot: process.argv[1] });
  try {
    await service.rebuildRuntimeConfig();
    const { app, pluginHost } = await createDeletionHttpFixture(t, access);
    registerSessionRoutes(app, { bot: access, runBotOperation: access.runOperation, pluginHost });
    const { userId } = identity;
    const [mode, root, targets] = process.argv.slice(2);
    await withTestServer(app, async (url) => {
      const response = await fetch(url + "/internal/session/" + userId + "/" + root, {
        method: "DELETE",
        headers: { connection: "close" },
      });
      const payload = await response.json();
      if (mode === "pinned") {
        assert.equal(response.status, 409, JSON.stringify(payload));
        assert.equal(payload.errorCode, "SESSION_MUTATION_BUSY");
      } else {
        assert.equal(response.status, 200, JSON.stringify(payload));
        assert.deepEqual(payload, { ok: true, deletedSessionIds: JSON.parse(targets) });
      }
    });
  } finally {
    await Promise.all(cleanup.map((fn) => fn()));
    await flushRuntimeEvents();
  }
  process.exit(0);
`;

test("a reader holds the cross-process lifecycle fence until its snapshot is retained", async (t) => {
  const { service } = await createPartitionBotFixture(t);
  const { bot } = await service.rebuildRuntimeConfig();
  await bot.session.applyTurnLifecycleEvent(firstSend());
  const { userId, sessionId } = identity;
  const repo = bot.sessionRuntime.repositories.sessionRepository;
  const context = { persistenceContext: repo.treePersistenceContext(userId, sessionId) };
  const located = Promise.withResolvers();
  const resume = Promise.withResolvers();
  const locate = repo.locateSessionScope.bind(repo);
  const mock = t.mock.method(repo, "locateSessionScope", async (...args) => {
    const scope = await locate(...args);
    located.resolve();
    await resume.promise;
    return scope;
  });
  const opening = repo.requireSessionReader(userId, sessionId, context);
  try {
    await Promise.race([located.promise, opening]);
    await assertDescriptorHeld(t, repo._sessionLifecycleLockPath(userId, sessionId));
  } finally {
    resume.resolve();
    mock.mock.restore();
    await using reader = await opening;
    assert.equal((await reader.readMetadata()).sessionId, sessionId);
  }
});

async function assertDescriptorHeld(t, lockPath) {
  const lockModule = import.meta.resolve("@noobot/platform-compatibility/descriptor-lock");
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { open } from "node:fs/promises";
         import { fileURLToPath } from "node:url";
         import { tryAcquireDescriptorLock } from ${JSON.stringify(lockModule)};
         await using handle = await open(fileURLToPath(process.argv[1]), "r+");
         if (await tryAcquireDescriptorLock(handle)) process.exitCode = 9;`,
      pathToFileURL(lockPath).href,
    ],
    { stdio: ["ignore", "ignore", "inherit"], signal: t.signal },
  );
  assert.deepEqual(await once(child, "exit"), [0, null]);
}

test("scoped directory admission holds the deletion publication fence while opening", async (t) => {
  const { service } = await createPartitionBotFixture(t);
  const { bot } = await service.rebuildRuntimeConfig();
  const { userId, sessionId } = identity;
  const authoritySessionId = "parent";
  await bot.session.applyTurnLifecycleEvent(
    firstSend({ ...identity, sessionId: authoritySessionId }),
  );
  await bot.session.applyTurnLifecycleEvent({
    ...firstSend(),
    parentSessionId: authoritySessionId,
  });
  const { sessionDir } = await bot.session.locateSessionScope(identity);
  const repo = bot.sessionRuntime.repositories.sessionRepository;
  const checked = Promise.withResolvers();
  const resume = Promise.withResolvers();
  const readState = repo._readDeletedSessions.bind(repo);
  const mock = t.mock.method(repo, "_readDeletedSessions", async (...args) => {
    const state = await readState(...args);
    checked.resolve();
    await resume.promise;
    return state;
  });
  const opening = bot.session.readScopedSessionSnapshot({ userId, authoritySessionId, sessionDir });
  try {
    await Promise.race([checked.promise, opening]);
    await assertDescriptorHeld(
      t,
      repo.pathResolver.sessionTombstoneLockFile(repo._basePath(userId)),
    );
  } finally {
    resume.resolve();
    mock.mock.restore();
    assert.equal((await opening).sessionSummary.sessionId, sessionId);
  }
});

for (const deleteAncestor of [false, true])
  test(
    `cross-process deletion of ${deleteAncestor ? "an ancestor" : "a session"} waits for retained cursors`,
    { timeout: 15000 },
    async (t) => {
      const { service, workspaceRoot, budget, setBudget } = await createPartitionBotFixture(t);
      setBudget({ ...budget, maxJournals: 3 });
      const { bot } = await service.rebuildRuntimeConfig();
      const { userId, sessionId } = identity;
      const authoritySessionId = "parent";
      const retainedId = "retained";
      const root = deleteAncestor ? authoritySessionId : sessionId;
      const targets = deleteAncestor ? [authoritySessionId, sessionId] : [sessionId];
      await bot.session.applyTurnLifecycleEvent(firstSend({ ...identity, sessionId: retainedId }));
      await bot.session.applyTurnLifecycleEvent(
        firstSend({ ...identity, sessionId: authoritySessionId }),
      );
      await bot.session.applyTurnLifecycleEvent({
        ...firstSend(),
        parentSessionId: authoritySessionId,
      });
      const { sessionDir } = await bot.session.locateSessionScope(identity);
      const { sessionDir: parentDir } = await bot.session.locateSessionScope({
        ...identity,
        sessionId: authoritySessionId,
      });
      const request = { sessionId, cursor: null, limit: 1, maxBytes: 4096, direction: "backward" };
      const tree = (cursor) =>
        bot.session.getSessionDisplayPage({ userId, request: { ...request, cursor } });
      const scoped = (cursor) =>
        bot.session.readScopedDisplayPage({
          userId,
          authoritySessionId,
          sessionDir,
          request: { ...request, cursor },
        });
      const retained = (cursor) =>
        bot.session.getSessionDisplayPage({
          userId,
          request: { ...request, sessionId: retainedId, cursor },
        });
      const retainedCursor = (await retained(null)).nextCursor;
      const treeCursor = (await tree(null)).nextCursor;
      const scopedCursor = (await scoped(null)).nextCursor;
      assert.ok(retainedCursor && treeCursor && scopedCursor);
      const repo = bot.sessionRuntime.repositories.sessionRepository;
      const snapshots = repo.pageSnapshots;
      const readOperation = () =>
        repo.readSessionBranchDeletion(userId, sessionBranchDeletionKey([root]));
      assert.equal(snapshots.entries.size, 3);

      const runDelete = async (mode) => {
        const child = spawn(
          process.execPath,
          [
            "--import",
            new URL("../../shared/testing/runtime-params.js", import.meta.url).href,
            "--input-type=module",
            "--eval",
            deleteSource,
            workspaceRoot,
            mode,
            root,
            JSON.stringify(targets),
          ],
          {
            cwd: new URL("../", import.meta.url),
            env: { ...process.env, [WORKSPACE_ROOT_ENV]: workspaceRoot },
            stdio: ["ignore", "ignore", "inherit"],
            signal: t.signal,
          },
        );
        assert.deepEqual(await once(child, "exit"), [0, null]);
      };
      await runDelete("pinned");
      assert.equal((await readOperation()).nextStage, STAGE.DIRECTORIES);
      assert.ok((await stat(sessionDir)).isDirectory());
      assert.ok((await stat(parentDir)).isDirectory());
      assert.equal(snapshots.entries.size, 3);
      const byDirectory = () =>
        bot.session.readScopedSessionSnapshot({ userId, authoritySessionId, sessionDir });
      await assert.rejects(byDirectory(), { code: "SESSION_DELETED", sessionId: root });
      for (const [read, cursor] of [
        [tree, treeCursor],
        [scoped, scopedCursor],
      ]) {
        await assert.rejects(read(cursor), { code: "SESSION_DELETED" });
        await assert.rejects(read(cursor), { code: "SESSION_PAGE_SNAPSHOT_EXPIRED" });
      }
      assert.equal(snapshots.entries.size, 1);
      await runDelete("drained");
      assert.equal((await readOperation()).nextStage, STAGE.COMPLETE);
      await assert.rejects(stat(sessionDir), { code: "ENOENT" });
      await assert.rejects(scoped(null), { code: "SESSION_DELETED", sessionId: root });
      await assert.rejects(
        byDirectory(),
        deleteAncestor
          ? { code: "SESSION_DELETED", sessionId: root }
          : { code: "SESSION_NOT_FOUND" },
      );
      if (deleteAncestor) await assert.rejects(stat(parentDir), { code: "ENOENT" });
      else assert.ok((await stat(parentDir)).isDirectory());
      assert.equal((await retained(retainedCursor)).sessionId, retainedId);
    },
  );

const crashSource = `
  import { createPartitionBotRuntime, firstSend, identity } from ${JSON.stringify(fixture.href)};
  import { attachScopeRoot } from ${JSON.stringify(layout.href)};
  import { mkdir } from "node:fs/promises";
  import { SESSION_DELETION_STAGE as STAGE } from "@noobot/workspace-protocol/session-tombstone";
  const { service } = createPartitionBotRuntime({ after() {} }, { workspaceRoot: process.argv[1] });
  const { bot } = await service.rebuildRuntimeConfig();
  const { userId, sessionId } = identity;
  await bot.session.applyTurnLifecycleEvent(firstSend());
  await mkdir(attachScopeRoot(bot.getWorkspacePath(userId), { sessionId, attachmentSource: "model" }), { recursive: true });
  const repo = bot.sessionRuntime.repositories.sessionRepository;
  const advance = repo.advanceSessionBranchDeletion.bind(repo);
  repo.advanceSessionBranchDeletion = (user, key, completedStage) => {
    if (completedStage === STAGE.ATTACHMENTS) process.exit(45);
    return advance(user, key, completedStage);
  };
  await bot.session.deleteSessionBranch({ userId, sessionIds: [sessionId] }, async ({ stage }) => {
    if (stage === STAGE.PLAN_PLUGINS) return ["fixture"];
    if (stage === STAGE.PLUGINS) return;
    if (stage === STAGE.ATTACHMENTS) return bot.deleteScopedAttachmentsBySessionIds({ userId, sessionIds: [sessionId] });
    throw new Error("unexpected cleanup stage: " + stage);
  });
`;

test(
  "branch deletion resumes an unconfirmed attachment cleanup after process exit",
  { timeout: 15000 },
  async (t) => {
    const { service, workspaceRoot } = await createPartitionBotFixture(t);
    const child = spawn(
      process.execPath,
      [
        "--import",
        new URL("../../shared/testing/runtime-params.js", import.meta.url).href,
        "--input-type=module",
        "--eval",
        crashSource,
        workspaceRoot,
      ],
      {
        cwd: new URL("../", import.meta.url),
        stdio: ["ignore", "ignore", "inherit"],
        signal: t.signal,
      },
    );
    assert.deepEqual(await once(child, "exit"), [45, null]);
    const { bot } = await service.rebuildRuntimeConfig();
    const { userId, sessionId } = identity;
    const attachment = attachScopeRoot(bot.getWorkspacePath(userId), {
      sessionId,
      attachmentSource: "model",
    });
    await assert.rejects(stat(attachment), { code: "ENOENT" });
    const stages = [];
    const result = await bot.session.deleteSessionBranch(
      { userId, sessionIds: [sessionId] },
      ({ stage, deletedSessionIds }) => {
        stages.push(stage);
        if (stage === STAGE.ATTACHMENTS)
          return bot.deleteScopedAttachmentsBySessionIds({ userId, sessionIds: deletedSessionIds });
        if (stage === STAGE.SHORT_MEMORY)
          return bot.deleteSessionMemoryBySessionIds({ userId, sessionIds: deletedSessionIds });
        assert.fail(`Unexpected replay stage: ${stage}`);
      },
    );
    assert.deepEqual(stages, [STAGE.ATTACHMENTS, STAGE.SHORT_MEMORY]);
    assert.deepEqual(result, { ok: true, deletedSessionIds: [sessionId] });
  },
);
