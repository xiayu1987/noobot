import test from "node:test";
import assert from "node:assert/strict";

import { createSessionFacade } from "../../../system-core/session/index.js";

test("createSessionFacade should delegate getContextRecords to sessionContextService", async () => {
  let captured = null;
  const session = createSessionFacade({
    sessionTreeService: {},
    sessionCrudService: {},
    sessionMessageService: {},
    sessionContextService: {
      async getContextRecords(payload = {}) {
        captured = payload;
        return [{ role: "user", content: "hi" }];
      },
    },
    taskService: {},
    executionLogService: {},
  });

  const result = await session.getContextRecords({
    userId: "u1",
    sessionId: "s1",
    userConfig: { x: 1 },
  });

  assert.deepEqual(captured, {
    userId: "u1",
    sessionId: "s1",
    userConfig: { x: 1 },
  });
  assert.deepEqual(result, [{ role: "user", content: "hi" }]);
});

test("createSessionFacade should delegate appendExecutionLog to executionLogService", async () => {
  let captured = null;
  const session = createSessionFacade({
    sessionTreeService: {},
    sessionCrudService: {},
    sessionMessageService: {},
    sessionContextService: {},
    taskService: {},
    executionLogService: {
      async appendExecutionLog(payload = {}) {
        captured = payload;
        return { ok: true };
      },
    },
  });

  const result = await session.appendExecutionLog({
    userId: "u1",
    sessionId: "s1",
    event: "thinking",
    category: "system",
    type: "trace",
    data: { text: "hello" },
    parentSessionId: "p1",
  });

  assert.equal(captured.userId, "u1");
  assert.equal(captured.sessionId, "s1");
  assert.equal(captured.event, "thinking");
  assert.equal(captured.parentSessionId, "p1");
  assert.deepEqual(result, { ok: true });
});

test("createSessionFacade should delegate CRUD and connector methods to sessionCrudService", async () => {
  const captured = [];
  const session = createSessionFacade({
    sessionTreeService: {},
    sessionCrudService: {
      async createSession(payload = {}) {
        captured.push(["createSession", payload]);
        return { exists: true };
      },
      async getSessionBundle(payload = {}) {
        captured.push(["getSessionBundle", payload]);
        return { exists: true, session: { sessionId: "s1" }, task: { tasks: [] } };
      },
      async setRootSessionSelectedConnectors(payload = {}) {
        captured.push(["setRootSessionSelectedConnectors", payload]);
        return { search: "google" };
      },
    },
    sessionMessageService: {},
    sessionContextService: {},
    taskService: {},
    executionLogService: {},
  });

  const created = await session.createSession({ userId: "u1", sessionId: "s1" });
  const bundle = await session.getSessionBundle({ userId: "u1", sessionId: "s1" });
  const connectors = await session.setRootSessionSelectedConnectors({
    userId: "u1",
    sessionId: "s1",
    selectedConnectors: { search: "google" },
  });

  assert.equal(captured.length, 3);
  assert.equal(captured[0][0], "createSession");
  assert.equal(captured[1][0], "getSessionBundle");
  assert.equal(captured[2][0], "setRootSessionSelectedConnectors");
  assert.deepEqual(created, { exists: true });
  assert.equal(bundle.exists, true);
  assert.deepEqual(connectors, { search: "google" });
});

test("createSessionFacade should delegate message and tree methods", async () => {
  let appendCaptured = null;
  let deleteCaptured = null;
  const session = createSessionFacade({
    sessionTreeService: {
      async deleteSessionBranch(payload = {}) {
        deleteCaptured = payload;
        return { ok: true, deletedSessionIds: ["s2"] };
      },
    },
    sessionCrudService: {},
    sessionMessageService: {
      async appendTurn(payload = {}) {
        appendCaptured = payload;
      },
      async getSessionTurns() {
        return [{ role: "user", content: "hi" }];
      },
    },
    sessionContextService: {},
    taskService: {},
    executionLogService: {},
  });

  await session.appendTurn({ userId: "u1", sessionId: "s1", role: "user", content: "hi" });
  const turns = await session.getSessionTurns({ userId: "u1", sessionId: "s1" });
  const deleted = await session.deleteSessionBranch({ userId: "u1", sessionId: "s2" });

  assert.equal(appendCaptured.sessionId, "s1");
  assert.equal(turns.length, 1);
  assert.equal(deleteCaptured.sessionId, "s2");
  assert.equal(deleted.ok, true);
});
