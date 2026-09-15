/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { TaskService } from "../../src/session/services/task-service.js";

function createRepos({ session = null, bundle = { tasks: [], currentTaskId: "" } } = {}) {
  const calls = { saved: [], savedBatch: [], savedSessions: [], mutations: 0, ensured: [] };
  const sessionRepo = {
    async resolveSessionScope(userId, sessionId, parentSessionId) {
      return { resolvedParentSessionId: parentSessionId || "resolved-parent" };
    },
    async withSessionMutation(userId, sessionId, parentSessionId, operation) {
      calls.mutations += 1;
      return operation();
    },
    async ensureSession(payload) {
      calls.ensured.push(payload);
    },
    async findById() {
      return session;
    },
    async save(userId, saved) {
      calls.savedSessions.push(saved);
    },
  };
  const taskRepo = {
    async getBundle() {
      return bundle;
    },
    async save(userId, sessionId, task) {
      calls.saved.push(task);
    },
    async saveBatch(userId, sessionId, tasks, parentSessionId, currentTaskId) {
      calls.savedBatch.push({ tasks, currentTaskId });
    },
  };
  return { sessionRepo, taskRepo, calls };
}

test("task service short-circuits every path when the session is missing", async () => {
  const { sessionRepo, taskRepo, calls } = createRepos({ session: null });
  const service = new TaskService({ sessionRepo, taskRepo });
  const args = { userId: "u1", sessionId: "s1" };

  assert.equal(await service.startSkillTask({ ...args, skillName: "demo" }), null);
  assert.equal(await service.finishSkillTask({ ...args, taskId: "t1" }), null);
  assert.equal(await service.saveCurrentTurnTasks({ ...args, currentTurnTasks: [] }), null);
  assert.equal(calls.mutations, 3);
  assert.equal(calls.ensured.length, 3);
  assert.equal(calls.ensured[0].parentSessionId, "resolved-parent");
  assert.deepEqual(calls.savedBatch, []);
});

test("startSkillTask completes the previous task and stamps the last message", async () => {
  const session = {
    currentTaskId: "old-task",
    messages: [{ id: "m1" }],
  };
  const bundle = {
    currentTaskId: "old-task",
    tasks: [{ taskId: "old-task", taskStatus: "start", endedAt: "" }],
  };
  const { sessionRepo, taskRepo, calls } = createRepos({ session, bundle });
  const service = new TaskService({ sessionRepo, taskRepo, now: () => "2026-01-01T00:00:00.000Z" });

  const task = await service.startSkillTask({
    userId: "u1",
    sessionId: "s1",
    skillName: "demo",
    meta: { a: 1 },
  });

  assert.equal(task.taskStatus, "start");
  assert.equal(task.taskName, "task-demo");
  assert.equal(task.startedAt, "2026-01-01T00:00:00.000Z");
  assert.deepEqual(task.meta, { a: 1 });
  assert.equal(bundle.tasks[0].taskStatus, "completed");
  assert.equal(bundle.tasks[0].endedAt, "2026-01-01T00:00:00.000Z");
  assert.equal(session.currentTaskId, task.taskId);
  assert.equal(session.messages[0].taskId, task.taskId);
  assert.equal(session.messages[0].taskStatus, "start");
  assert.equal(calls.saved.length, 1);
  assert.equal(calls.savedSessions.length, 1);
});

test("finishSkillTask clears the current task id and records the result", async () => {
  const session = { currentTaskId: "t1", messages: [{ id: "m1" }] };
  const bundle = { currentTaskId: "t1", tasks: [{ taskId: "t1", taskStatus: "start" }] };
  const { sessionRepo, taskRepo, calls } = createRepos({ session, bundle });
  const service = new TaskService({ sessionRepo, taskRepo, now: () => "2026-01-02T00:00:00.000Z" });

  const task = await service.finishSkillTask({
    userId: "u1",
    sessionId: "s1",
    taskId: "t1",
    result: "done",
  });

  assert.equal(task.taskStatus, "completed");
  assert.equal(task.endedAt, "2026-01-02T00:00:00.000Z");
  assert.equal(task.result, "done");
  assert.equal(session.currentTaskId, "");
  assert.equal(session.messages[0].taskStatus, "completed");
  assert.deepEqual(calls.savedBatch, [{ tasks: bundle.tasks, currentTaskId: "" }]);
});

test("finishSkillTask returns null when no task id can be resolved", async () => {
  const session = { currentTaskId: "", messages: [] };
  const bundle = { currentTaskId: "", tasks: [] };
  const { sessionRepo, taskRepo, calls } = createRepos({ session, bundle });
  const service = new TaskService({ sessionRepo, taskRepo });

  assert.equal(await service.finishSkillTask({ userId: "u1", sessionId: "s1" }), null);
  assert.deepEqual(calls.savedBatch, []);
});

test("finishSkillTask returns null when the resolved task is absent from the bundle", async () => {
  const session = { currentTaskId: "missing", messages: [] };
  const bundle = { currentTaskId: "missing", tasks: [{ taskId: "other" }] };
  const { sessionRepo, taskRepo, calls } = createRepos({ session, bundle });
  const service = new TaskService({ sessionRepo, taskRepo });

  assert.equal(await service.finishSkillTask({ userId: "u1", sessionId: "s1" }), null);
  assert.deepEqual(calls.savedBatch, []);
});

test("saveCurrentTurnTasks drops blank task ids and returns the persisted bundle", async () => {
  const session = { currentTaskId: "stale", messages: [] };
  const bundle = { currentTaskId: "t2", tasks: [] };
  const { sessionRepo, taskRepo, calls } = createRepos({ session, bundle });
  const service = new TaskService({ sessionRepo, taskRepo });

  const returned = await service.saveCurrentTurnTasks({
    userId: "u1",
    sessionId: "s1",
    currentTurnTasks: [{ taskId: "t1" }, { taskId: "  " }, null, { taskId: "t2" }],
  });

  assert.equal(returned, bundle);
  assert.deepEqual(calls.savedBatch, [
    { tasks: [{ taskId: "t1" }, { taskId: "t2" }], currentTaskId: "t2" },
  ]);
  assert.equal(session.currentTaskId, "t2");
});

test("task service falls back to legacy repo hooks when mutation guard is absent", async () => {
  const session = { currentTaskId: "", messages: [] };
  const bundle = { currentTaskId: "", tasks: [] };
  const { taskRepo } = createRepos({ session, bundle });
  const legacySessionRepo = {
    async resolveParentSessionId(userId, sessionId, parentSessionId) {
      return parentSessionId || "legacy-parent";
    },
    async ensureSession() {},
    async findById() {
      return session;
    },
    async save() {},
  };
  const service = new TaskService({ sessionRepo: legacySessionRepo, taskRepo });

  const returned = await service.saveCurrentTurnTasks({
    userId: "u1",
    sessionId: "s1",
    currentTurnTasks: [{ taskId: "t9" }],
  });

  assert.equal(returned, bundle);
  assert.equal(session.currentTaskId, "t9");
});
