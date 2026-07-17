/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
// Tests split by responsibility from session-repository-boundary.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import { createSessionServices } from "../../../src/system-core/session/index.js";
import { writeSessionArtifact } from "../../../src/system-core/session/session-artifact-store.js";
import { buildSessionDisplaySummary } from "../../../src/system-core/session/session-summary-builders.js";

async function withTempWorkspace(fn) {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "noobot-session-boundary-"),
  );
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
    await mkdir(path.join(workspaceRoot, userId), { recursive: true });

    const runtime = createSessionServices(
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
    assert.equal(await exists(sessionScope.executionFile), false);

    await runtime.repositories.taskRepository.save(userId, sessionId, {
      taskId: "t1",
      taskName: "task-1",
      taskStatus: "start",
    });
    assert.equal(await exists(sessionScope.taskFile), true);

    await runtime.repositories.executionRepository.appendLog(
      userId,
      sessionId,
      { event: "start", dialogProcessId: "dp-1" },
    );
    assert.equal(await exists(sessionScope.executionFile), true);
    const executionEventsFile = path.join(sessionScope.sessionDir, "execution.jsonl");
    assert.equal(await exists(executionEventsFile), true);

    const taskBundle = JSON.parse(await readFile(sessionScope.taskFile, "utf8"));
    assert.equal(taskBundle.currentTaskId, "t1");
    const executionBundle = JSON.parse(
      await readFile(sessionScope.executionFile, "utf8"),
    );
    assert.equal("logs" in executionBundle, false);
    assert.equal(executionBundle.dialogProcessId, "dp-1");
    const executionEvents = (await readFile(executionEventsFile, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.equal(executionEvents.length, 1);
    assert.equal(executionEvents[0].event, "start");
    assert.equal(executionEvents[0].dialogProcessId, "dp-1");
    const restoredBundle = await runtime.repositories.executionRepository.getBundle(userId, sessionId);
    assert.equal(restoredBundle.dialogProcessId, "dp-1");
    assert.equal(restoredBundle.logs.length, 1);
    assert.equal(restoredBundle.logs[0].event, "start");
    assert.equal(restoredBundle.logs[0].dialogProcessId, "dp-1");
  });
});

test("deleteSessionBranch should remove descendant directories and tree nodes", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    await mkdir(path.join(workspaceRoot, userId), { recursive: true });

    const runtime = createSessionServices(
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

    const scopeA = await runtime.repositories.sessionRepository.resolveSessionScope(userId, "A", "");
    const scopeB = await runtime.repositories.sessionRepository.resolveSessionScope(userId, "B", "A");
    const scopeC = await runtime.repositories.sessionRepository.resolveSessionScope(userId, "C", "B");

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
    assert.deepEqual(tree.nodes.A.children, []);

    const summary = await runtime.repositories.sessionRepository.readSessionsSummary(userId);
    assert.deepEqual(summary.sessions.map((item) => item.sessionId), ["A"]);
  });
});











test("appendTurn should not recreate session after deletion marker is set", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    const sessionId = "race-session";
    await mkdir(path.join(workspaceRoot, userId), { recursive: true });

    const runtime = createSessionServices(
      { workspaceRoot },
      { now: () => "2026-05-14T00:00:00.000Z" },
    );

    await runtime.sessionCrudService.ensureSession(userId, sessionId);
    const scope = await runtime.repositories.sessionRepository.resolveSessionScope(userId, sessionId);
    assert.equal(await exists(scope.sessionFile), true);

    await runtime.sessionTreeService.deleteSessionBranch({ userId, sessionId });
    assert.equal(await exists(scope.sessionFile), false);

    await runtime.sessionMessageService.appendTurn({
      userId,
      sessionId,
      role: "assistant",
      content: "late async write",
    });

    assert.equal(await exists(scope.sessionFile), false);
  });
});

test("task and execution writes should not recreate a deleted session directory", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    const sessionId = "deleted-write-barrier";
    await mkdir(path.join(workspaceRoot, userId), { recursive: true });
    const runtime = createSessionServices({ workspaceRoot });

    await runtime.sessionCrudService.ensureSession(userId, sessionId);
    const scope = await runtime.repositories.sessionRepository.resolveSessionScope(userId, sessionId);
    await runtime.sessionTreeService.deleteSessionBranch({ userId, sessionId });

    assert.equal(await runtime.repositories.taskRepository.save(userId, sessionId, {
      taskId: "late-task",
      taskName: "late task",
      taskStatus: "start",
    }), false);
    assert.equal(await runtime.repositories.fileSystemExecutionRepository.saveBundle(userId, sessionId, {}), false);
    assert.equal(await runtime.repositories.fileSystemExecutionRepository.appendLog(
      userId,
      sessionId,
      { event: "late-log" },
    ), false);
    assert.equal(await exists(scope.sessionDir), false);

    const restartedRuntime = createSessionServices({ workspaceRoot });
    assert.equal(
      await restartedRuntime.repositories.sessionRepository.isSessionDeleted(userId, sessionId),
      true,
    );
    assert.equal(
      await restartedRuntime.repositories.fileSystemExecutionRepository.appendLog(
        userId,
        sessionId,
        { event: "late-log-after-restart" },
      ),
      false,
    );
    assert.equal(await exists(scope.sessionDir), false);
  });
});

test("late execution initialization should not restore a deleted session tree node", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    const sessionId = "deleted-tree-node";
    await mkdir(path.join(workspaceRoot, userId), { recursive: true });
    const runtime = createSessionServices({ workspaceRoot });

    await runtime.sessionTreeService.upsertSessionTree({ userId, sessionId });
    await runtime.sessionCrudService.ensureSession(userId, sessionId);
    await runtime.sessionTreeService.deleteSessionBranch({ userId, sessionId });

    assert.equal(
      await runtime.sessionTreeService.upsertSessionTree({ userId, sessionId }),
      false,
    );
    const tree = await runtime.sessionTreeService.getSessionTree({ userId });
    assert.equal(Boolean(tree.nodes[sessionId]), false);
    assert.equal(tree.roots.includes(sessionId), false);
    assert.deepEqual(
      (await runtime.sessionCrudService.getAllSessionSummaries({ userId }))
        .map((item) => item.sessionId),
      [],
    );
  });
});



