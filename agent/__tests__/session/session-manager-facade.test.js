/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createSessionFacade } from "../../src/session/index.js";

function createFacadeRuntime(overrides = {}) {
  const contexts = [];
  const runtime = {
    sessionTreeService: {},
    sessionCrudService: {},
    sessionMessageService: {},
    sessionContextService: {},
    executionLogService: {},
    repositories: { connectorInstanceRepository: {} },
    createSessionPersistenceContext(input) {
      contexts.push(input);
      return Object.freeze({ kind: "test-context", sessionId: input.sessionId });
    },
    ...overrides,
  };
  return { runtime, contexts };
}

test("createSessionFacade delegates getContextProjection with normalized scope fields", async () => {
  let captured = null;
  const projection = { scope: {}, messages: [{ role: "user", content: "hi" }] };
  const { runtime } = createFacadeRuntime({
    sessionContextService: {
      async getContextProjection(payload) {
        captured = payload;
        return projection;
      },
    },
  });
  const session = createSessionFacade(runtime);

  const result = await session.getContextProjection({
    userId: "u1",
    sessionId: "s1",
    currentTurnScopeId: "turn-current",
  });

  assert.equal(captured.userId, "u1");
  assert.equal(captured.sessionId, "s1");
  assert.equal(captured.currentTurnScopeId, "turn-current");
  assert.equal(captured.persistenceContext.kind, "test-context");
  assert.equal(Object.hasOwn(captured, "parentSessionId"), false);
  assert.equal(result, projection);
});

test("createSessionFacade should delegate appendExecutionLog to executionLogService", async () => {
  let captured = null;
  const { runtime } = createFacadeRuntime({
    executionLogService: {
      async appendExecutionLog(payload = {}) {
        captured = payload;
        return { ok: true };
      },
    },
  });
  const session = createSessionFacade(runtime);

  const result = await session.appendExecutionLog({
    userId: "u1",
    sessionId: "s1",
    event: "thinking",
    category: "system",
    type: "trace",
    data: { text: "hello" },
  });

  assert.equal(captured.userId, "u1");
  assert.equal(captured.sessionId, "s1");
  assert.equal(captured.event, "thinking");
  assert.equal(captured.persistenceContext.kind, "test-context");
  assert.deepEqual(result, { ok: true });
  await assert.rejects(
    () => session.appendExecutionLog({ userId: "u1", sessionId: "s1", parentSessionId: "p1" }),
    /without parentSessionId/,
  );
});

test("createSessionFacade preserves scoped execution turn log fields", async () => {
  let captured = null;
  const { runtime, contexts } = createFacadeRuntime({
    executionLogService: {
      async getTurnLogs(payload = {}) {
        captured = payload;
        return [];
      },
    },
  });
  const session = createSessionFacade(runtime);
  const persistenceScope = {
    scopeId: "agent:workflow-node",
    parentSessionId: "parent-1",
    relativeDir: "runtime/plugin-data/workflow/session/parent-1/child-1",
    allowedRoot: "runtime/plugin-data/workflow/session",
  };

  await session.getExecutionTurnLogs({
    userId: "u1",
    sessionId: "child-1",
    dialogProcessId: "dp-1",
    persistenceScope,
  });

  assert.deepEqual(contexts, [{ userId: "u1", sessionId: "child-1", persistenceScope }]);
  assert.deepEqual(captured, {
    userId: "u1",
    sessionId: "child-1",
    dialogProcessId: "dp-1",
    persistenceContext: { kind: "test-context", sessionId: "child-1" },
  });
  await assert.rejects(
    () =>
      session.getExecutionTurnLogs({
        userId: "u1",
        sessionId: "child-1",
        persistenceContext: captured.persistenceContext,
      }),
    /derives persistence context from persistenceScope/,
  );
});

test("createSessionFacade resolves authority outbox access from the protocol persistence scope", async () => {
  const calls = [];
  const persistenceScope = {
    scopeId: "agent:workflow-node-1",
    parentSessionId: "root-session",
    relativeDir: "runtime/plugin-data/workflow/session/root-session/workflow-node-1",
    allowedRoot: "runtime/plugin-data/workflow/session",
  };
  const methods = [
    "getPendingAuthorityEvents",
    "recordAuthorityEventAttempts",
    "acknowledgeAuthorityEvents",
    "compactAuthorityEvents",
  ];
  const { runtime, contexts } = createFacadeRuntime({
    sessionMessageService: Object.fromEntries(
      methods.map((method) => [
        method,
        async (payload) => {
          calls.push({ method, payload });
          return { ok: true };
        },
      ]),
    ),
  });
  const session = createSessionFacade(runtime);
  const identity = { userId: "u1", sessionId: "child-session", persistenceScope };

  await session.getPendingAuthorityEvents(identity);
  await session.recordAuthorityEventAttempts({ ...identity, eventIds: ["event-1"] });
  await session.acknowledgeAuthorityEvents({
    ...identity,
    acknowledgements: [{ eventId: "event-1" }],
  });
  await session.compactAuthorityEvents({ ...identity, consumerId: "service.websocket" });

  assert.deepEqual(
    calls.map(({ method }) => method),
    methods,
  );
  assert.equal(contexts.length, 4);
  for (const context of contexts) {
    assert.deepEqual(context, { userId: "u1", sessionId: "child-session", persistenceScope });
  }
  for (const { payload } of calls) {
    assert.equal(Object.hasOwn(payload, "persistenceScope"), false);
    assert.equal(Object.hasOwn(payload, "parentSessionId"), false);
    assert.equal(payload.persistenceContext.kind, "test-context");
  }
  await assert.rejects(
    () => session.getPendingAuthorityEvents({ ...identity, parentSessionId: "root-session" }),
    /without parentSessionId/,
  );
});

test("createSessionFacade should delegate CRUD and connector methods to sessionCrudService", async () => {
  const captured = [];
  const record = (name, result) => async (payload) => {
    captured.push([name, payload]);
    return typeof result === "function" ? result(payload) : result;
  };
  const { runtime } = createFacadeRuntime({
    sessionCrudService: {
      createSession: record("createSession", { exists: true }),
      getSessionBundle: record("getSessionBundle", {
        exists: true,
        session: { sessionId: "s1" },
        task: { tasks: [] },
      }),
      setRootSessionSelectedConnectorIds: record("setRootSessionSelectedConnectorIds", [
        "con_google",
      ]),
      renameSession: record("renameSession", (payload) => ({
        sessionId: payload.sessionId,
        customTitle: payload.title,
      })),
    },
  });
  const session = createSessionFacade(runtime);

  const created = await session.createSession({
    userId: "u1",
    sessionId: "s1",
    parentSessionId: "",
    caller: "user",
  });
  const bundle = await session.getSessionBundle({ userId: "u1", sessionId: "s1" });
  const connectors = await session.setRootSessionSelectedConnectorIds({
    userId: "u1",
    sessionId: "s1",
    selectedConnectorIds: ["con_google"],
  });
  const renamed = await session.renameSession({ userId: "u1", sessionId: "s1", title: "new name" });

  assert.deepEqual(
    captured.map(([name]) => name),
    ["createSession", "getSessionBundle", "setRootSessionSelectedConnectorIds", "renameSession"],
  );

  assert.equal(captured[0][1].parentSessionId, "");
  assert.equal(captured[0][1].persistenceContext.kind, "test-context");
  assert.equal(captured[1][1].persistenceContext.kind, "test-context");
  assert.equal(captured[3][1].persistenceContext.kind, "test-context");
  assert.deepEqual(created, { exists: true });
  assert.equal(bundle.exists, true);
  assert.deepEqual(connectors, ["con_google"]);
  assert.deepEqual(renamed, { sessionId: "s1", customTitle: "new name" });
  await assert.rejects(
    () => session.getSessionBundle({ userId: "u1", sessionId: "s1", parentSessionId: "" }),
    /without parentSessionId/,
  );
});

test("createSessionFacade should delegate message and tree methods", async () => {
  let appendCaptured = null;
  let deleteCaptured = null;
  const { runtime } = createFacadeRuntime({
    sessionTreeService: {
      async deleteSessionBranch(payload = {}) {
        deleteCaptured = payload;
        return { ok: true, deletedSessionIds: ["s2"] };
      },
    },
    sessionMessageService: {
      async appendTurns(payload = {}) {
        appendCaptured = payload;
        return { appended: true, reason: "", turns: payload.turns };
      },
      async getSessionTurns() {
        return [{ role: "user", content: "hi" }];
      },
    },
  });
  const session = createSessionFacade(runtime);

  await session.appendTurns({
    userId: "u1",
    sessionId: "s1",
    turns: [{ role: "user", content: "hi" }],
  });
  const turns = await session.getSessionTurns({ userId: "u1", sessionId: "s1" });
  const deleted = await session.deleteSessionBranch({ userId: "u1", sessionIds: ["s2"] });

  assert.equal(appendCaptured.sessionId, "s1");
  assert.equal(appendCaptured.persistenceContext.kind, "test-context");
  assert.equal(turns.length, 1);
  assert.deepEqual(deleteCaptured, { userId: "u1", sessionIds: ["s2"] });
  assert.equal(deleted.ok, true);
});
