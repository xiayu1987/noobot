/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";

import { createTestSessionServices } from "../helpers/session-services.js";
import { readExecutionLogs } from "../../src/session/session-artifact-store.js";
import { initializeUserWorkspace } from "../helpers/user-workspace.js";

async function withTempWorkspace(fn) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-session-boundary-"));
  try {
    return await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

test("session/task/execution repositories should keep file ownership boundaries", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    const sessionId = "s1";
    await initializeUserWorkspace(workspaceRoot, userId);

    const runtime = createTestSessionServices(
      { workspaceRoot },
      { now: () => "2026-05-14T00:00:00.000Z" },
    );

    await runtime.sessionCrudService.ensureSession(userId, sessionId);

    const sessionScope = await runtime.repositories.sessionRepository.resolveSessionScope(
      userId,
      sessionId,
    );

    assert.equal(await exists(sessionScope.sessionFile), true);
    assert.equal(await exists(sessionScope.taskFile), false);

    await runtime.repositories.taskRepository.save(userId, sessionId, {
      taskId: "t1",
      taskName: "task-1",
      taskStatus: "start",
    });
    assert.equal(await exists(sessionScope.taskFile), true);

    await runtime.repositories.executionRepository.appendLog(userId, sessionId, {
      event: "start",
      dialogProcessId: "dp-1",
    });
    assert.equal(
      await exists(path.join(sessionScope.sessionDir, "execution-events/index.json")),
      true,
    );
    assert.equal(
      await exists(path.join(sessionScope.sessionDir, "execution-events/turns/dp-1/index.json")),
      true,
    );

    const taskBundle = JSON.parse(await readFile(sessionScope.taskFile, "utf8"));
    assert.equal(taskBundle.currentTaskId, "t1");
    const executionEvents = await readExecutionLogs(sessionScope.sessionDir);
    assert.equal(executionEvents.length, 1);
    assert.equal(executionEvents[0].event, "start");
    assert.equal(executionEvents[0].dialogProcessId, "dp-1");
    const turnLogs = await runtime.repositories.executionRepository.getTurnLogs(
      userId,
      sessionId,
      "dp-1",
    );
    assert.equal(turnLogs.length, 1);
    assert.equal(turnLogs[0].event, "start");
    assert.equal(turnLogs[0].dialogProcessId, "dp-1");
    assert.deepEqual(
      await runtime.repositories.executionRepository.getTurnLogs(userId, sessionId, "dp-other"),
      [],
    );
  });
});

test("deleteSessionBranch should remove descendant directories and tree nodes", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    await initializeUserWorkspace(workspaceRoot, userId);

    const runtime = createTestSessionServices(
      { workspaceRoot },
      { now: () => "2026-05-14T00:00:00.000Z" },
    );

    await runtime.sessionTreeService.upsertSessionTree({ userId, sessionId: "A" });
    await runtime.sessionCrudService.ensureSession(userId, "A", "");

    await runtime.sessionTreeService.upsertSessionTree({
      userId,
      sessionId: "B",
      parentSessionId: "A",
    });
    await runtime.sessionCrudService.ensureSession(userId, "B", "A");

    await runtime.sessionTreeService.upsertSessionTree({
      userId,
      sessionId: "C",
      parentSessionId: "B",
    });
    await runtime.sessionCrudService.ensureSession(userId, "C", "B");

    const scopeA = await runtime.repositories.sessionRepository.resolveSessionScope(
      userId,
      "A",
      "",
    );
    const scopeB = await runtime.repositories.sessionRepository.resolveSessionScope(
      userId,
      "B",
      "A",
    );
    const scopeC = await runtime.repositories.sessionRepository.resolveSessionScope(
      userId,
      "C",
      "B",
    );

    const result = await runtime.sessionTreeService.deleteSessionBranch({
      userId,
      sessionId: "B",
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.deletedSessionIds.sort(), ["B", "C"]);
    assert.equal(await exists(scopeA.sessionFile), true);
    assert.equal(await exists(scopeB.sessionFile), false);
    assert.equal(await exists(scopeC.sessionFile), false);

    const tree = await runtime.sessionTreeService.getSessionTree({ userId });
    assert.equal(Boolean(tree.nodes.A), true);
    assert.equal(Boolean(tree.nodes.B), false);
    assert.equal(Boolean(tree.nodes.C), false);
    assert.deepEqual(Object.keys(tree.nodes), ["A"]);

    const summary = await runtime.repositories.sessionRepository.readSessionsSummary(userId);
    assert.deepEqual(
      summary.sessions.map((item) => item.sessionId),
      ["A"],
    );
  });
});

test("ensureSession registers child Sessions in the Session Tree and deleteSessionBranch tombstones them", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    const rootSessionId = "workflow-root";
    const childSessionId = "workflow-child";
    await initializeUserWorkspace(workspaceRoot, userId);

    const runtime = createTestSessionServices({ workspaceRoot });
    await runtime.sessionTreeService.upsertSessionTree({
      userId,
      sessionId: rootSessionId,
    });
    await runtime.sessionCrudService.ensureSession(userId, rootSessionId);
    await runtime.repositories.sessionRepository.ensureSession({
      userId,
      sessionId: childSessionId,
      parentSessionId: rootSessionId,
    });

    const treeBeforeDelete = await runtime.sessionTreeService.getSessionTree({ userId });
    assert.deepEqual(treeBeforeDelete.nodes[childSessionId], {
      sessionId: childSessionId,
      parentSessionId: rootSessionId,
    });
    const rootScope = await runtime.repositories.sessionRepository.resolveSessionScope(
      userId,
      rootSessionId,
    );

    const result = await runtime.sessionTreeService.deleteSessionBranch({
      userId,
      sessionId: rootSessionId,
    });

    assert.deepEqual(result.deletedSessionIds.sort(), [childSessionId, rootSessionId]);
    assert.equal(
      await runtime.repositories.sessionRepository.isSessionDeleted(userId, childSessionId),
      true,
    );
    await assert.rejects(
      runtime.repositories.fileSystemExecutionRepository.appendLog(
        userId,
        childSessionId,
        { event: "late-workflow-log", dialogProcessId: "dp-late" },
        rootSessionId,
      ),
      { code: "SESSION_DELETED" },
    );
    assert.equal(await exists(rootScope.sessionDir), false);
  });
});

test("appendTurns should not recreate session after deletion marker is set", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    const sessionId = "race-session";
    await initializeUserWorkspace(workspaceRoot, userId);

    const runtime = createTestSessionServices(
      { workspaceRoot },
      { now: () => "2026-05-14T00:00:00.000Z" },
    );

    await runtime.sessionCrudService.ensureSession(userId, sessionId);
    const scope = await runtime.repositories.sessionRepository.resolveSessionScope(
      userId,
      sessionId,
    );
    assert.equal(await exists(scope.sessionFile), true);

    await runtime.sessionTreeService.deleteSessionBranch({ userId, sessionId });
    assert.equal(await exists(scope.sessionFile), false);

    await runtime.sessionMessageService.appendTurns({
      userId,
      sessionId,
      turns: [{ role: "assistant", content: "late async write" }],
    });

    assert.equal(await exists(scope.sessionFile), false);
  });
});

test("task and execution writes should not recreate a deleted session directory", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    const sessionId = "deleted-write-barrier";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });

    await runtime.sessionCrudService.ensureSession(userId, sessionId);
    const scope = await runtime.repositories.sessionRepository.resolveSessionScope(
      userId,
      sessionId,
    );
    await runtime.sessionTreeService.deleteSessionBranch({ userId, sessionId });

    await assert.rejects(
      runtime.repositories.taskRepository.save(userId, sessionId, {
        taskId: "late-task",
        taskName: "late task",
        taskStatus: "start",
      }),
      { code: "SESSION_DELETED" },
    );
    await assert.rejects(
      runtime.repositories.fileSystemExecutionRepository.appendLog(userId, sessionId, {
        event: "late-log",
        dialogProcessId: "dp-late",
      }),
      { code: "SESSION_DELETED" },
    );
    assert.equal(await exists(scope.sessionDir), false);

    const restartedRuntime = createTestSessionServices({ workspaceRoot });
    assert.equal(
      await restartedRuntime.repositories.sessionRepository.isSessionDeleted(userId, sessionId),
      true,
    );
    await assert.rejects(
      restartedRuntime.repositories.fileSystemExecutionRepository.appendLog(userId, sessionId, {
        event: "late-log-after-restart",
        dialogProcessId: "dp-late",
      }),
      { code: "SESSION_DELETED" },
    );
    assert.equal(await exists(scope.sessionDir), false);
  });
});

test("late execution initialization should not restore a deleted session tree node", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    const sessionId = "deleted-tree-node";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });

    await runtime.sessionTreeService.upsertSessionTree({ userId, sessionId });
    await runtime.sessionCrudService.ensureSession(userId, sessionId);
    await runtime.sessionTreeService.deleteSessionBranch({ userId, sessionId });

    await assert.rejects(runtime.sessionTreeService.upsertSessionTree({ userId, sessionId }), {
      code: "SESSION_DELETED",
    });
    const tree = await runtime.sessionTreeService.getSessionTree({ userId });
    assert.equal(Boolean(tree.nodes[sessionId]), false);
    assert.deepEqual(
      (await runtime.sessionCrudService.getAllSessionSummaries({ userId })).map(
        (item) => item.sessionId,
      ),
      [],
    );
  });
});

test("persistenceContext writes should respect deleted-session tombstones", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    const sessionId = "deleted-context-session";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });

    await runtime.sessionCrudService.ensureSession(userId, sessionId);
    const scope = await runtime.repositories.sessionRepository.resolveSessionScope(
      userId,
      sessionId,
    );
    const persistenceContext = {
      locationResolver: runtime.repositories.sessionRepository.sessionPathResolver,
    };
    await runtime.sessionTreeService.deleteSessionBranch({ userId, sessionId });

    await assert.rejects(
      runtime.repositories.sessionRepository.ensureSession({
        userId,
        sessionId,
        persistenceContext,
      }),
      { code: "SESSION_DELETED" },
    );
    assert.equal(
      await runtime.repositories.sessionRepository.findById(
        userId,
        sessionId,
        "",
        persistenceContext,
      ),
      null,
    );
    await assert.rejects(
      runtime.repositories.sessionRepository.save(
        userId,
        { sessionId, messages: [{ role: "user", content: "late" }] },
        "",
        { persistenceContext },
      ),
      { code: "SESSION_DELETED" },
    );
    await assert.rejects(
      runtime.repositories.taskRepository.save(
        userId,
        sessionId,
        { taskId: "late-task", taskName: "late", taskStatus: "start" },
        "",
        persistenceContext,
      ),
      { code: "SESSION_DELETED" },
    );
    await assert.rejects(
      runtime.repositories.fileSystemExecutionRepository.appendLog(
        userId,
        sessionId,
        { event: "late", dialogProcessId: "dp-late" },
        "",
        persistenceContext,
      ),
      { code: "SESSION_DELETED" },
    );
    assert.equal(await exists(scope.sessionDir), false);
    assert.deepEqual(await runtime.repositories.sessionRepository.listSessionIds(userId), []);
  });
});

test("a session deleted before the lifecycle lock is rejected without creating artifacts", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    const sessionId = "deleted-before-lock";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    const repo = runtime.repositories.sessionRepository;
    const scope = await repo.resolveSessionScope(userId, sessionId);
    await runtime.sessionCrudService.ensureSession(userId, sessionId);
    await runtime.sessionTreeService.deleteSessionBranch({ userId, sessionId });

    await assert.rejects(repo.ensureSession({ userId, sessionId }), { code: "SESSION_DELETED" });
    assert.equal(await exists(scope.sessionDir), false);
    assert.deepEqual(await repo.listSessionIds(userId), []);
  });
});

test("a child of a deleted parent is rejected before any artifact or tree node is written", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    const parentSessionId = "deleted-parent";
    const childSessionId = "late-child";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    const repo = runtime.repositories.sessionRepository;
    await runtime.sessionCrudService.ensureSession(userId, parentSessionId);
    const parentScope = await repo.resolveSessionScope(userId, parentSessionId);
    await runtime.sessionTreeService.deleteSessionBranch({ userId, sessionId: parentSessionId });

    await assert.rejects(
      repo.ensureSession({ userId, sessionId: childSessionId, parentSessionId }),
      { code: "SESSION_DELETED" },
    );
    assert.equal(await exists(parentScope.sessionDir), false);
    assert.equal(
      (await runtime.sessionTreeService.getSessionTree({ userId })).nodes[childSessionId],
      undefined,
    );
  });
});
