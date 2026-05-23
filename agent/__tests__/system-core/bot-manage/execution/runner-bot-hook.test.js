import test from "node:test";
import assert from "node:assert/strict";

import { SessionExecutionRunner } from "../../../../src/system-core/bot-manage/execution/runner.js";
import {
  BOT_HOOK_POINTS,
  createBotHookManager,
} from "../../../../src/system-core/bot-manage/hook/index.js";

function createRunner({
  botHookManager = createBotHookManager(),
  agentRunner = async () => ({
    output: "ok",
    traces: [],
    turnMessages: [],
    turnTasks: [],
  }),
} = {}) {
  return new SessionExecutionRunner({
    agentRunner,
    errorLogger: { async log() {} },
    normalizeRunMessage: (message = "") => String(message || "").trim(),
    validateRunInput() {},
    ensureParentAsyncResultContainer: ({ parentAsyncResultContainer = null } = {}) =>
      parentAsyncResultContainer,
    initializeRunSessionRuntime: async ({ eventListener = null } = {}) => ({
      usedSessionId: "s1",
      dialogProcessId: "dp1",
      isContinue: false,
      userConfig: {},
      currentSessionModelAlias: "",
      executionStartIndex: 0,
      runtimeEventListener: eventListener,
    }),
    resolveScenarioRunConfig: (runConfig = {}) => runConfig,
    prepareRunConfig: (payload = {}) => ({
      ...(payload?.runConfig || {}),
      botHookManager,
    }),
    prepareAgentTurnExecution: async () => ({
      agentContext: {
        execution: { controllers: { runtime: { attachmentMetas: [] } } },
      },
      runtimeAgentContext: {
        execution: { controllers: { runtime: { attachmentMetas: [] } } },
      },
    }),
    appendSessionTurn: async () => {},
    finalizeRunSession: async () => ({ answer: "ok" }),
    upsertParentAsyncTask: () => {},
    now: () => new Date().toISOString(),
  });
}

test("SessionExecutionRunner emits bot orchestration hooks", async () => {
  const botHookManager = createBotHookManager();
  const events = [];
  let beforeDispatchContext = null;
  botHookManager.on(BOT_HOOK_POINTS.BEFORE_SESSION_RUN, () => events.push("before_session_run"));
  botHookManager.on(BOT_HOOK_POINTS.BEFORE_AGENT_DISPATCH, (ctx = {}) => {
    events.push("before_agent_dispatch");
    beforeDispatchContext = ctx;
  });
  botHookManager.on(BOT_HOOK_POINTS.AFTER_AGENT_DISPATCH, () =>
    events.push("after_agent_dispatch"),
  );
  botHookManager.on(BOT_HOOK_POINTS.AFTER_SESSION_RUN, () => events.push("after_session_run"));
  const runner = createRunner({ botHookManager });

  const result = await runner.runSession({
    userId: "u1",
    sessionId: "s1",
    message: "hello",
    runConfig: {},
  });

  assert.equal(result.answer, "ok");
  assert.deepEqual(events, [
    "before_session_run",
    "before_agent_dispatch",
    "after_agent_dispatch",
    "after_session_run",
  ]);
  assert.equal(Boolean(beforeDispatchContext?.agentContext), false);
  assert.equal(typeof beforeDispatchContext?.agentContextSummary, "object");
});

test("SessionExecutionRunner emits bot error hooks", async () => {
  const botHookManager = createBotHookManager();
  const events = [];
  botHookManager.on(BOT_HOOK_POINTS.AGENT_DISPATCH_ERROR, () => events.push("agent_dispatch_error"));
  botHookManager.on(BOT_HOOK_POINTS.SESSION_RUN_ERROR, () => events.push("session_run_error"));
  const runner = createRunner({
    botHookManager,
    agentRunner: async () => {
      throw new Error("mock agent failure");
    },
  });

  await assert.rejects(
    () =>
      runner.runSession({
        userId: "u1",
        sessionId: "s1",
        message: "hello",
        runConfig: {},
      }),
    /mock agent failure/,
  );
  assert.deepEqual(events, ["agent_dispatch_error", "session_run_error"]);
});
