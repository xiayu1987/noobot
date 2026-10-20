/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createSessionFacade } from "../../../src/session/index.js";
import { finalizeAgentTurn } from "../../../src/bot/execution/runner/result-finalizer.js";

function createRealFacade(calls) {
  return createSessionFacade({
    sessionTreeService: {},
    sessionCrudService: {},
    sessionMessageService: {
      async getSessionTurns(payload) {
        calls.push(["getSessionTurns", payload]);
        return [];
      },
      async getTurnSummaryCheckpointState(payload) {
        calls.push(["getTurnSummaryCheckpointState", payload]);
        return null;
      },
    },
    sessionContextService: {},
    taskService: {},
    executionLogService: {},
    repositories: { connectorInstanceRepository: {} },
    createSessionPersistenceContext: ({ sessionId }) => Object.freeze({ kind: "ctx", sessionId }),
  });
}

test("finalizeAgentTurn locates existing child sessions through the real facade", async () => {
  const calls = [];
  const session = createRealFacade(calls);
  let finalizePayload = null;

  await finalizeAgentTurn({
    resolvedRunConfig: {},
    runtimeEventListener: null,
    usedSessionId: "child-1",
    dialogProcessId: "dp-1",
    resolvedTurnScopeId: "turn-1",
    dispatchRuntime: {},
    getSessionTurns: (payload) => session.getSessionTurns(payload),
    getTurnSummaryCheckpointState: (payload) => session.getTurnSummaryCheckpointState(payload),
    finalizeRunSession: async (payload) => {
      finalizePayload = payload;
      return { ok: true };
    },
    userId: "u1",
    parentSessionId: "parent-1",
    parentDialogProcessId: "",
    caller: "user",
    agentResult: { turnMessages: [] },
    userConfig: {},
    lifecycle: null,
    persistenceScope: null,
  });

  assert.deepEqual(
    calls.map(([name]) => name),
    ["getTurnSummaryCheckpointState", "getSessionTurns"],
  );
  for (const [, payload] of calls) {
    assert.equal(Object.hasOwn(payload, "parentSessionId"), false);
    assert.equal(payload.persistenceContext.sessionId, "child-1");
  }
  assert.equal(finalizePayload.parentSessionId, "parent-1");
});
