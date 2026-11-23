/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createSessionFacade } from "../../../src/session/index.js";
import { createTestRuntimeContext } from "../../helpers/test-runtime-context.js";
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
    },
    sessionContextService: {},
    executionLogService: {},
    repositories: { connectorInstanceRepository: {} },
    createSessionPersistenceContext: ({ sessionId }) => Object.freeze({ kind: "ctx", sessionId }),
  });
}

test("finalizeAgentTurn flushes the child scope without reading history through the facade", async () => {
  const calls = [];
  const session = createRealFacade(calls);
  let finalizePayload = null;

  await finalizeAgentTurn({
    resolvedRunConfig: {},
    runtimeEventListener: null,
    usedSessionId: "child-1",
    dialogProcessId: "dp-1",
    resolvedTurnScopeId: "turn-1",
    dispatchRuntime: createTestRuntimeContext({
      persistCurrentTurnMessages: async () => calls.push(["flush"]),
    }),
    userMessageUid: "sm_user",
    getSessionTurns: (payload) => session.getSessionTurns(payload),
    finalizeRunSession: async (payload) => {
      finalizePayload = payload;
      assert.deepEqual(calls, [], "creating the finalization port must not read history");
      await payload.turnPersistence.flush();
      assert.deepEqual(await payload.turnPersistence.readResultTransfers(), []);
      return { ok: true };
    },
    userId: "u1",
    parentSessionId: "parent-1",
    parentDialogProcessId: "",
    caller: "user",
    agentResult: {
      turnMessages: [{ messageUid: "sm_final", role: "assistant", content: "done" }],
    },
    userConfig: {},
    lifecycle: null,
    persistenceScope: null,
  });

  assert.deepEqual(
    calls.map(([name]) => name),
    ["flush"],
  );
  assert.equal(finalizePayload.parentSessionId, "parent-1");
  assert.equal(finalizePayload.sessionId, "child-1");
  assert.equal(finalizePayload.turnScopeId, "turn-1");
  assert.equal(finalizePayload.dialogProcessId, "dp-1");
});
