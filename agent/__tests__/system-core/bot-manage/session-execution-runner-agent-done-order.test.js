import test from "node:test";
import assert from "node:assert/strict";

import { SessionExecutionRunner } from "../../../src/system-core/bot-manage/execution/runner.js";

function createRunner({ callOrder, eventListener, finalizeRunSession }) {
  return new SessionExecutionRunner({
    agentRunner: async () => {
      callOrder.push("agentRunner");
      return {
        output: "ok",
        traces: [{ id: "trace-1" }],
        turnMessages: [{ role: "assistant", type: "message", content: "ok" }],
        turnTasks: [],
      };
    },
    errorLogger: {
      async log() {
        callOrder.push("errorLogger.log");
      },
    },
    normalizeRunMessage: (message) => message,
    validateRunInput: () => {},
    ensureParentAsyncResultContainer: () => null,
    initializeRunSessionRuntime: async () => ({
      usedSessionId: "session-used",
      dialogProcessId: "dialog-1",
      isContinue: false,
      userConfig: {},
      currentSessionModelAlias: "",
      executionStartIndex: 0,
      runtimeEventListener: eventListener,
    }),
    resolveScenarioRunConfig: (runConfig) => runConfig,
    prepareRunConfig: ({ runConfig }) => runConfig,
    buildAgentContext: async () => ({
      execution: {
        controllers: {
          runtime: {
            attachmentMetas: [],
          },
        },
      },
    }),
    appendSessionTurn: async () => {
      callOrder.push("appendSessionTurn");
    },
    buildRunTurnAgentContext: () => ({}),
    finalizeRunSession,
    upsertParentAsyncTask: () => {
      callOrder.push("upsertParentAsyncTask");
    },
    now: () => "2026-05-21T00:00:00.000Z",
  });
}

test("runSession emits agent_done only after finalizeRunSession resolves", async () => {
  const callOrder = [];
  const eventListener = {
    onEvent({ event }) {
      callOrder.push(`event:${event}`);
    },
  };
  const runner = createRunner({
    callOrder,
    eventListener,
    finalizeRunSession: async () => {
      callOrder.push("finalizeRunSession");
      return { ok: true };
    },
  });

  const result = await runner.runSession({
    userId: "u1",
    sessionId: "s1",
    message: "hello",
  });

  assert.equal(result.ok, true);
  const finalizeIndex = callOrder.indexOf("finalizeRunSession");
  const doneIndex = callOrder.indexOf("event:agent_done");
  assert.ok(finalizeIndex >= 0);
  assert.ok(doneIndex >= 0);
  assert.ok(doneIndex > finalizeIndex);
});

test("runSession does not emit agent_done when finalizeRunSession fails", async () => {
  const callOrder = [];
  const eventListener = {
    onEvent({ event }) {
      callOrder.push(`event:${event}`);
    },
  };
  const runner = createRunner({
    callOrder,
    eventListener,
    finalizeRunSession: async () => {
      callOrder.push("finalizeRunSession");
      throw new Error("finalize failed");
    },
  });

  await assert.rejects(
    () =>
      runner.runSession({
        userId: "u1",
        sessionId: "s1",
        message: "hello",
      }),
    /finalize failed/,
  );

  assert.equal(callOrder.includes("event:agent_done"), false);
  assert.equal(callOrder.includes("upsertParentAsyncTask"), true);
  assert.equal(callOrder.includes("errorLogger.log"), true);
});
