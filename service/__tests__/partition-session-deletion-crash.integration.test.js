/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ATTACHMENT_METADATA_ERROR_CODE,
  projectAttachmentIdentity,
} from "@noobot/attachment-protocol";
import {
  PARTITION_JOURNAL_HEAD_FILE,
  PARTITION_JOURNAL_PUBLICATION_LOCK,
} from "@noobot/session-protocol/partition-journal";
import {
  SESSION_DELETION_STAGE,
  sessionBranchDeletionKey,
  sessionDeletionStagingName,
} from "@noobot/workspace-protocol/session-tombstone";
import {
  attachmentScopeIndexPath,
  attachScopeRoot,
  attachSessionRoot,
} from "../../agent/src/artifacts/service/attachment-storage-layout.js";
import { journalRemovalLockPath } from "../../agent/src/session/partition-storage/journal-publication-lock.js";
import { recoverWorkspaceAttachmentCatalogs } from "../../agent/src/workspace-lifecycle/attachment-catalog-upgrade.js";
import { readSessionDirectory } from "../../agent/src/workspace-lifecycle/session-directory-walk.js";
import { resolveSessionArtifactMutationLock } from "../../agent/src/session/session-artifact-files.js";
import { createPartitionBotFixture, identity } from "./partition-bot-assembly.test-helpers.js";
import {
  createDeletionHttpFixture,
  runsDirectory,
} from "./partition-session-deletion-crash.test-helpers.js";
import { registerSessionRoutes, withTestServer } from "./routes/session-routes.helpers.js";
import { WORKSPACE_ROOT_ENV } from "@noobot/runtime-topology-protocol/workspace-root";
import {
  DELETION_WORKER_BUDGET,
  runDeletionWorker,
} from "./deletion-worker-process.test-helpers.js";

async function crashDeletion(t, workspaceRoot, retainedId, crashStage, window, ...fixtureArgs) {
  const worker = fileURLToPath(
    new URL("./partition-session-deletion-crash-worker.js", import.meta.url),
  );
  const env = { ...process.env, [WORKSPACE_ROOT_ENV]: workspaceRoot };
  delete env.NODE_TEST_CONTEXT;
  const { termination, output } = await runDeletionWorker(
    [
      "--import",
      new URL("../../shared/testing/runtime-params.js", import.meta.url).href,
      worker,
      workspaceRoot,
      retainedId,
      crashStage,
      window,
      ...fixtureArgs,
    ],
    { env, signal: t.signal },
  );
  const lines = output.split("\n");
  assert.ok(lines.includes(`crash:${crashStage}:${window}`), output);
  assert.deepEqual(
    termination,
    process.platform === "win32" ? [1, null] : [null, "SIGKILL"],
    output,
  );
}

const { DIRECTORIES, TREE, PLUGINS, ATTACHMENTS, SHORT_MEMORY, COMPLETE } = SESSION_DELETION_STAGE;
const stages = [DIRECTORIES, TREE, PLUGINS, ATTACHMENTS, SHORT_MEMORY];

const crashRecoveryTimeout =
  2 * DELETION_WORKER_BUDGET.startupMs + DELETION_WORKER_BUDGET.operationMs;

test(
  "a parent deletion cannot take over its child's interrupted directory cleanup",
  { timeout: crashRecoveryTimeout },
  async (t) => {
    const { service, access, workspaceRoot } = await createPartitionBotFixture(t);
    const { userId, sessionId } = identity;
    const parentId = "parent";
    const retainedId = "retained";
    await crashDeletion(t, workspaceRoot, retainedId, DIRECTORIES, "after-rename", parentId);

    const { bot } = await service.rebuildRuntimeConfig();
    const repo = bot.sessionRuntime.repositories.sessionRepository;
    const { sessionDir: parentDir } = await bot.session.locateSessionScope({
      ...identity,
      sessionId: parentId,
    });
    const readOperation = (id) =>
      repo.readSessionBranchDeletion(userId, sessionBranchDeletionKey([id]));
    const pending = await readOperation(sessionId);
    const childDir = join(bot.getWorkspacePath(userId), ...pending.targets[0].directory);
    assert.equal(dirname(childDir), parentDir);
    const staging = join(
      parentDir,
      sessionDeletionStagingName(pending.targets[0].directory.at(-1)),
    );
    await stat(staging);

    const { app, pluginHost } = await createDeletionHttpFixture(t, access);
    registerSessionRoutes(app, { bot: access, runBotOperation: access.runOperation, pluginHost });
    await withTestServer(app, async (url) => {
      const remove = (id) => fetch(`${url}/internal/session/${userId}/${id}`, { method: "DELETE" });
      const conflict = await remove(parentId);
      const problem = await conflict.json();
      assert.equal(conflict.status, 410, JSON.stringify(problem));
      assert.equal(problem.errorCode, "SESSION_DELETED");
      assert.equal(await readOperation(parentId), undefined);
      assert.deepEqual(await readOperation(sessionId), pending);
      await stat(staging);

      for (const id of [sessionId, parentId]) {
        const response = await remove(id);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { ok: true, deletedSessionIds: [id] });
        assert.equal((await readOperation(id)).nextStage, COMPLETE);
        if (id === sessionId) {
          await assert.rejects(stat(staging), { code: "ENOENT" });
          await stat(parentDir);
        }
      }
      await assert.rejects(stat(parentDir), { code: "ENOENT" });
      assert.ok(await bot.session.locateSessionScope({ ...identity, sessionId: retainedId }));
    });
  },
);

const windows = [
  [DIRECTORIES, "before-rename"],
  [DIRECTORIES, "after-rename"],
  [DIRECTORIES, "recursive-rm"],
  [DIRECTORIES, "before-lock-rm"],
  [ATTACHMENTS, "partial-attachment-rm"],
  [SHORT_MEMORY, "before-memory-publish"],
  ...stages.map((stage) => [stage, "before-ack"]),
];

for (const [crashStage, window] of windows) {
  const crashIndex = stages.indexOf(crashStage);
  test(
    `HTTP resumes ${crashStage} after SIGKILL at ${window}`,
    { timeout: crashRecoveryTimeout },
    async (t) => {
      const { service, access, workspaceRoot } = await createPartitionBotFixture(t);
      const { userId, sessionId } = identity;
      const retainedId = "retained";
      await crashDeletion(t, workspaceRoot, retainedId, crashStage, window);

      const { bot } = await service.rebuildRuntimeConfig();
      const { sessionRepository: repo, sessionTreeRepository: treeRepo } =
        bot.sessionRuntime.repositories;
      const readOperation = () =>
        repo.readSessionBranchDeletion(userId, sessionBranchDeletionKey([sessionId]));
      const operation = await readOperation();
      assert.equal(operation.nextStage, crashStage);
      assert.deepEqual(
        operation.targets.map((target) => target.sessionId),
        [sessionId],
      );
      assert.ok(operation.pluginHandlerIds.length > 0);
      const basePath = bot.getWorkspacePath(userId);
      const deletedDirectory = join(basePath, ...operation.targets[0].directory);
      const artifactLock = resolveSessionArtifactMutationLock(deletedDirectory);
      const journalLock = journalRemovalLockPath(deletedDirectory);
      const stagingName = sessionDeletionStagingName(operation.targets[0].directory.at(-1));
      const staging = join(dirname(deletedDirectory), stagingName);
      const readTree = () => treeRepo.getTree(userId);
      const readRuns = async () => (await readdir(runsDirectory(basePath))).sort();
      const readAttachments = (id) =>
        bot.attach.readAttachmentMetas({ userId, sessionId: id, attachmentSource: "model" });
      const readMemory = () => bot.memory.shortMemory.readItems(basePath);
      const memoryPath = bot.memory.storage.shortPath(basePath);
      const readMemoryStaging = async () =>
        (await readdir(dirname(memoryPath))).filter((name) => name.endsWith(".tmp"));
      if (window === "before-memory-publish") assert.equal((await readMemoryStaging()).length, 1);
      const finished = (stage) =>
        stages.indexOf(stage) < crashIndex || (stage === crashStage && window === "before-ack");
      if (window === "before-rename") await stat(deletedDirectory);
      else await assert.rejects(stat(deletedDirectory), { code: "ENOENT" });
      if (
        process.platform === "win32" &&
        ["before-rename", "after-rename", "recursive-rm"].includes(window)
      )
        await stat(journalLock);
      else await assert.rejects(stat(journalLock), { code: "ENOENT" });
      if (finished(DIRECTORIES)) await assert.rejects(stat(artifactLock), { code: "ENOENT" });
      else await stat(artifactLock);
      if (crashStage === DIRECTORIES && ["after-rename", "recursive-rm"].includes(window)) {
        await stat(join(staging, PARTITION_JOURNAL_HEAD_FILE));
        const lock = join(staging, PARTITION_JOURNAL_PUBLICATION_LOCK);
        if (window === "recursive-rm") await assert.rejects(stat(lock), { code: "ENOENT" });
        else await stat(lock);
        const { entries, children } = await readSessionDirectory(dirname(deletedDirectory));
        assert.ok(entries.some(({ name }) => name === stagingName));
        assert.ok(!children.some(({ name }) => name === stagingName));
        assert.ok(children.some(({ name }) => name === retainedId));
      } else {
        await assert.rejects(stat(staging), { code: "ENOENT" });
      }
      assert.deepEqual(
        Object.keys((await readTree()).nodes).sort(),
        finished(TREE) ? [retainedId] : [retainedId, sessionId],
      );
      assert.deepEqual(
        await readRuns(),
        finished(PLUGINS) ? [`${retainedId}-run`] : [`${retainedId}-run`, `${sessionId}-run`],
      );
      if (finished(ATTACHMENTS)) {
        await assert.rejects(
          stat(attachScopeRoot(basePath, { sessionId, attachmentSource: "model" })),
          {
            code: "ENOENT",
          },
        );
      } else if (window === "partial-attachment-rm") {
        const scope = { sessionId, attachmentSource: "model" };
        await assert.rejects(stat(attachmentScopeIndexPath(basePath, scope)), { code: "ENOENT" });
        assert.ok((await readdir(attachScopeRoot(basePath, scope))).length > 0);
      } else {
        assert.equal((await readAttachments(sessionId)).length, 1);
      }
      const retainedAttachments = await readAttachments(retainedId);
      assert.equal(retainedAttachments.length, 1);
      const retainedAttachment = projectAttachmentIdentity(retainedAttachments[0]);
      if (window === "partial-attachment-rm") {
        const missingAttachment = { ...retainedAttachment, sessionId: "missing-attachment-scope" };
        await assert.rejects(
          bot.attach.linkParsedResultToAttachment({
            userId,
            sourceIdentity: missingAttachment,
            targetIdentity: retainedAttachment,
            producerId: "test",
          }),
          { code: ATTACHMENT_METADATA_ERROR_CODE.MISSING },
        );
        await assert.rejects(stat(attachScopeRoot(basePath, missingAttachment)), {
          code: "ENOENT",
        });
      }
      if (crashStage === PLUGINS && window === "before-ack") {
        const catalog = attachmentScopeIndexPath(basePath, {
          sessionId,
          attachmentSource: "model",
        });
        await writeFile(catalog, "unreadable catalog");
        await recoverWorkspaceAttachmentCatalogs(basePath);
        await stat(catalog);
        assert.equal((await readOperation()).nextStage, PLUGINS);
      }
      const deletedAttachment = { ...retainedAttachment, sessionId };
      const assertLateAttachmentWritesRejected = async () => {
        const deleted = { code: "SESSION_DELETED", sessionId };
        const artifacts = [
          {
            name: "late.txt",
            mimeType: "text/plain",
            contentBase64: Buffer.from("late").toString("base64"),
          },
        ];
        await assert.rejects(
          bot.attach.ingestGeneratedArtifacts({ userId, sessionId, artifacts }),
          deleted,
        );
        await assert.rejects(
          bot.attach.ingestEmailArtifacts({ userId, sessionId, artifacts }),
          deleted,
        );
        await assert.rejects(
          bot.attach.ingest({ userId, sessionId, attachments: artifacts }),
          deleted,
        );
        for (const [sourceIdentity, targetIdentity] of [
          [deletedAttachment, retainedAttachment],
          [retainedAttachment, deletedAttachment],
        ]) {
          await assert.rejects(
            bot.attach.linkParsedResultToAttachment({
              userId,
              sourceIdentity,
              targetIdentity,
              producerId: "test",
            }),
            deleted,
          );
        }
      };
      await assertLateAttachmentWritesRejected();
      const memory = await readMemory();
      const retainedMemory = memory.filter((item) => item.sessionId === retainedId);
      assert.equal(retainedMemory.length, 1);
      assert.equal(memory.length, finished(SHORT_MEMORY) ? 1 : 2);
      const capture = (id, parentSessionId) =>
        bot.memory.captureDialogToShortMemory({
          userId,
          sessionId: id,
          parentSessionId,
          dialogProcessId: "dialog",
          messageRecords: [
            {
              ordinal: 1,
              message: { sessionId: id, dialogProcessId: "dialog", role: "user", content: id },
            },
          ],
        });
      const assertLateCapturesRejected = async () => {
        const deleted = { code: "SESSION_DELETED", sessionId };
        await assert.rejects(capture(sessionId, ""), deleted);
        await assert.rejects(capture("late-child", sessionId), deleted);
      };
      await assertLateCapturesRejected();
      assert.deepEqual(await readMemory(), memory);
      if (window === "before-memory-publish") assert.equal((await readMemoryStaging()).length, 1);

      const { app, pluginHost } = await createDeletionHttpFixture(t, access);
      const pluginCleanup = t.mock.fn(pluginHost.emitAfterSessionDelete.bind(pluginHost));
      const plan = t.mock.fn(pluginHost.listSessionDeletionHandlers.bind(pluginHost));
      const observed = [
        t.mock.method(repo, "removeDeletedSessionDirectory"),
        t.mock.method(treeRepo, "updateTree"),
        pluginCleanup,
        t.mock.method(bot, "deleteScopedAttachmentsBySessionIds"),
        t.mock.method(bot, "deleteSessionMemoryBySessionIds"),
      ];
      registerSessionRoutes(app, {
        bot: access,
        runBotOperation: access.runOperation,
        pluginHost: { listSessionDeletionHandlers: plan, emitAfterSessionDelete: pluginCleanup },
      });
      await withTestServer(app, async (url) => {
        for (let attempt = 0; attempt < 2; attempt++) {
          const response = await fetch(`${url}/internal/session/${userId}/${sessionId}`, {
            method: "DELETE",
          });
          const payload = await response.json();
          assert.equal(response.status, 200, JSON.stringify(payload));
          assert.deepEqual(payload, { ok: true, deletedSessionIds: [sessionId] });
        }
      });
      assert.equal(plan.mock.callCount(), 0);
      if (pluginCleanup.mock.callCount()) {
        const [context] = pluginCleanup.mock.calls[0].arguments;
        assert.deepEqual(context.pluginHandlerIds, operation.pluginHandlerIds);
        assert.deepEqual(context.deletedSessionIds, [sessionId]);
      }
      assert.deepEqual(
        observed.map((step) => step.mock.callCount()),
        stages.map((_, index) => Number(index >= crashIndex)),
      );
      assert.deepEqual(await readOperation(), { ...operation, nextStage: COMPLETE });
      await assert.rejects(stat(deletedDirectory), { code: "ENOENT" });
      await assert.rejects(stat(artifactLock), { code: "ENOENT" });
      await assert.rejects(stat(journalLock), { code: "ENOENT" });
      await assert.rejects(stat(staging), { code: "ENOENT" });
      assert.deepEqual(Object.keys((await readTree()).nodes), [retainedId]);
      assert.deepEqual(await bot.session.listSessionIds({ userId }), [retainedId]);
      assert.deepEqual(await readRuns(), [`${retainedId}-run`]);
      assert.deepEqual(await readAttachments(sessionId), []);
      await assertLateAttachmentWritesRejected();
      assert.deepEqual(await readAttachments(retainedId), retainedAttachments);
      await assert.rejects(stat(attachSessionRoot(basePath, sessionId)), { code: "ENOENT" });
      await assertLateCapturesRejected();
      assert.deepEqual(await readMemory(), retainedMemory);
      assert.deepEqual(await readMemoryStaging(), []);
    },
  );
}
