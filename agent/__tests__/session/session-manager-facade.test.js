/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createSessionFacade } from "../../src/session/index.js";

test("createSessionFacade delegates getContextProjection with normalized scope fields", async () => {
  let captured = null;
  const projection = { scope: {}, messages: [{ role: "user", content: "hi" }] };
  const session = createSessionFacade({
    sessionTreeService: {},
    sessionCrudService: {},
    sessionMessageService: {},
    sessionContextService: {
      async getContextProjection(payload) {
        captured = payload;
        return projection;
      },
    },
    taskService: {},
    executionLogService: {},
  });

  const result = await session.getContextProjection({
    userId: "u1",
    sessionId: "s1",
    currentTurnScopeId: "turn-current",
  });

  assert.deepEqual(captured, {
    userId: "u1",
    sessionId: "s1",
    currentDialogProcessId: "",
    currentTurnScopeId: "turn-current",
  });
  assert.equal(result, projection);
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

test("createSessionFacade preserves scoped execution turn log fields", async () => {
  let captured = null;
  const session = createSessionFacade({
    sessionTreeService: {},
    sessionCrudService: {},
    sessionMessageService: {},
    sessionContextService: {},
    taskService: {},
    executionLogService: {
      async getTurnLogs(payload = {}) {
        captured = payload;
        return [];
      },
    },
  });
  const persistenceContext = { locationResolver: { scopeId: "workflow-node" } };

  await session.getExecutionTurnLogs({
    userId: "u1",
    sessionId: "child-1",
    dialogProcessId: "dp-1",
    parentSessionId: "parent-1",
    persistenceContext,
  });

  assert.deepEqual(captured, {
    userId: "u1",
    sessionId: "child-1",
    dialogProcessId: "dp-1",
    parentSessionId: "parent-1",
    persistenceContext,
  });
});

test("createSessionFacade resolves authority outbox access from the protocol persistence scope", async () => {
  const calls = [];
  const contexts = [];
  const persistenceScope = {
    scopeId: "agent:workflow-node-1",
    parentSessionId: "root-session",
    relativeDir: "runtime/plugin-data/workflow/session/root-session/workflow-node-1",
    allowedRoot: "runtime/plugin-data/workflow/session",
  };
  const runtime = {
    sessionTreeService: {},
    sessionCrudService: {},
    sessionMessageService: Object.fromEntries(
      [
        "getPendingAuthorityEvents",
        "recordAuthorityEventAttempts",
        "acknowledgeAuthorityEvents",
        "compactAuthorityEvents",
      ].map((method) => [
        method,
        async (payload) => {
          calls.push({ method, payload });
          return { ok: true };
        },
      ]),
    ),
    sessionContextService: {},
    taskService: {},
    executionLogService: {},
    createScopedPersistenceContext(payload) {
      contexts.push(payload);
      return Object.freeze({ kind: "test-scope", locationResolver: {} });
    },
  };
  const session = createSessionFacade(runtime);
  const identity = {
    userId: "u1",
    sessionId: "child-session",
    parentSessionId: "root-session",
    persistenceScope,
  };

  await session.getPendingAuthorityEvents(identity);
  await session.recordAuthorityEventAttempts({ ...identity, eventIds: ["event-1"] });
  await session.acknowledgeAuthorityEvents({
    ...identity,
    acknowledgements: [{ eventId: "event-1" }],
  });
  await session.compactAuthorityEvents({ ...identity, consumerId: "service.websocket" });

  assert.equal(calls.length, 4);
  assert.equal(contexts.length, 4);
  for (const { payload } of calls) {
    assert.equal(payload.persistenceScope, persistenceScope);
    assert.equal(payload.parentSessionId, "root-session");
    assert.equal(payload.persistenceContext.kind, "test-scope");
  }
  assert.deepEqual(contexts[0], {
    userId: "u1",
    sessionId: "child-session",
    parentSessionId: "root-session",
    scopeId: "agent:workflow-node-1",
    relativeDir: "runtime/plugin-data/workflow/session/root-session/workflow-node-1",
    allowedRoot: "runtime/plugin-data/workflow/session",
  });
  await expectAuthorityScopeConflict(session, persistenceScope);
});

async function expectAuthorityScopeConflict(session, persistenceScope) {
  await assert.rejects(
    () =>
      session.getPendingAuthorityEvents({
        userId: "u1",
        sessionId: "child-session",
        parentSessionId: "different-root",
        persistenceScope,
      }),
    /parent does not match its authority protocol scope/,
  );
}

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
      async setRootSessionSelectedConnectorIds(payload = {}) {
        captured.push(["setRootSessionSelectedConnectorIds", payload]);
        return ["con_google"];
      },
      async renameSession(payload = {}) {
        captured.push(["renameSession", payload]);
        return { sessionId: payload.sessionId, customTitle: payload.title };
      },
    },
    sessionMessageService: {},
    sessionContextService: {},
    taskService: {},
    executionLogService: {},
  });

  const created = await session.createSession({ userId: "u1", sessionId: "s1" });
  const bundle = await session.getSessionBundle({ userId: "u1", sessionId: "s1" });
  const connectors = await session.setRootSessionSelectedConnectorIds({
    userId: "u1",
    sessionId: "s1",
    selectedConnectorIds: ["con_google"],
  });
  const renamed = await session.renameSession({ userId: "u1", sessionId: "s1", title: "new name" });

  assert.equal(captured.length, 4);
  assert.equal(captured[0][0], "createSession");
  assert.equal(captured[1][0], "getSessionBundle");
  assert.equal(captured[2][0], "setRootSessionSelectedConnectorIds");
  assert.equal(captured[3][0], "renameSession");
  assert.deepEqual(created, { exists: true });
  assert.equal(bundle.exists, true);
  assert.deepEqual(connectors, ["con_google"]);
  assert.deepEqual(renamed, { sessionId: "s1", customTitle: "new name" });
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
      async appendTurns(payload = {}) {
        appendCaptured = payload;
        return { appended: true, reason: "", turns: payload.turns };
      },
      async getSessionTurns() {
        return [{ role: "user", content: "hi" }];
      },
    },
    sessionContextService: {},
    taskService: {},
    executionLogService: {},
  });

  await session.appendTurns({
    userId: "u1",
    sessionId: "s1",
    turns: [{ role: "user", content: "hi" }],
  });
  const turns = await session.getSessionTurns({ userId: "u1", sessionId: "s1" });
  const deleted = await session.deleteSessionBranch({ userId: "u1", sessionId: "s2" });

  assert.equal(appendCaptured.sessionId, "s1");
  assert.equal(turns.length, 1);
  assert.equal(deleteCaptured.sessionId, "s2");
  assert.equal(deleted.ok, true);
});
