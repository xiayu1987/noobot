import test from "node:test";
import assert from "node:assert/strict";

import { SessionExecutionRunner } from "../../../../src/system-core/bot-manage/execution/runner.js";
import {
  BOT_HOOK_POINTS,
  createBotHookManager,
} from "../../../../src/system-core/bot-manage/hook/index.js";
import { warnAgentContextCompatFieldOnce } from "../../../../src/system-core/context/compatibility-deprecation.js";

function createRunner({
  botHookManager = createBotHookManager(),
  agentRunner = async () => ({
    output: "ok",
    traces: [],
    turnMessages: [],
    turnTasks: [],
  }),
  prepareAgentTurnExecution = async () => ({
    agentContext: {
      execution: { controllers: { runtime: { attachmentMetas: [] } } },
    },
    runtimeAgentContext: {
      execution: { controllers: { runtime: { attachmentMetas: [] } } },
    },
  }),
  initializeRunSessionRuntime = async ({ eventListener = null } = {}) => ({
    usedSessionId: "s1",
    dialogProcessId: "dp1",
    isContinue: false,
    userConfig: {},
    currentSessionModelAlias: "",
    executionStartIndex: 0,
    runtimeEventListener: eventListener,
  }),
  resolveScenarioRunConfig = (runConfig = {}) => runConfig,
} = {}) {
  return new SessionExecutionRunner({
    agentRunner,
    errorLogger: { async log() {} },
    normalizeRunMessage: (message = "") => String(message || "").trim(),
    validateRunInput() {},
    ensureParentAsyncResultContainer: ({ parentAsyncResultContainer = null } = {}) =>
      parentAsyncResultContainer,
    initializeRunSessionRuntime,
    resolveScenarioRunConfig,
    prepareRunConfig: (payload = {}) => ({
      ...(payload?.runConfig || {}),
      botHookManager,
    }),
    prepareAgentTurnExecution,
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
  let capturedBuildContextPayload = null;
  botHookManager.on(BOT_HOOK_POINTS.BEFORE_SESSION_RUN, () => events.push("before_session_run"));
  botHookManager.on(BOT_HOOK_POINTS.BEFORE_AGENT_DISPATCH, (ctx = {}) => {
    events.push("before_agent_dispatch");
    beforeDispatchContext = ctx;
  });
  botHookManager.on(BOT_HOOK_POINTS.AFTER_AGENT_DISPATCH, () =>
    events.push("after_agent_dispatch"),
  );
  botHookManager.on(BOT_HOOK_POINTS.AFTER_SESSION_RUN, () => events.push("after_session_run"));
  const runner = createRunner({
    botHookManager,
    prepareAgentTurnExecution: async ({ buildContextPayload = {} } = {}) => {
      capturedBuildContextPayload = buildContextPayload;
      const runtimeAgentContext = {
        payload: {
          messages: {
            history: [
              { role: "user", content: "history user" },
              { role: "assistant", content: "history assistant" },
            ],
          },
        },
        execution: { controllers: { runtime: { attachmentMetas: [] } } },
      };
      return { agentContext: runtimeAgentContext, runtimeAgentContext };
    },
  });

  const result = await runner.runSession({
    userId: "u1",
    sessionId: "s1",
    message: "hello",
    attachments: [{ attachmentId: "att1" }],
    runConfig: {},
  });

  assert.equal(result.answer, "ok");
  assert.deepEqual(events, [
    "before_session_run",
    "before_agent_dispatch",
    "after_agent_dispatch",
    "after_session_run",
  ]);
  assert.deepEqual(capturedBuildContextPayload?.inputAttachmentMetas, [{ attachmentId: "att1" }]);
  assert.equal(capturedBuildContextPayload?.attachmentMetas, undefined);
  assert.equal(Boolean(beforeDispatchContext?.agentContext), false);
  assert.equal(typeof beforeDispatchContext?.agentContextSummary, "object");
  assert.deepEqual(beforeDispatchContext?.messages, [
    { role: "user", content: "history user" },
    { role: "assistant", content: "history assistant" },
  ]);
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

test("SessionExecutionRunner emits compat field hit stats event", async () => {
  const events = [];
  const eventListener = {
    onEvent(payload = {}) {
      events.push(payload);
    },
  };
  const runtimeAgentContext = {
    execution: {
      dialogProcessId: "dp1",
      controllers: {
        runtime: {
          systemRuntime: {
            sessionId: "s1",
            dialogProcessId: "dp1",
          },
        },
      },
    },
  };
  const runner = createRunner({
    prepareAgentTurnExecution: async () => ({
      agentContext: runtimeAgentContext,
      runtimeAgentContext,
    }),
    agentRunner: async () => {
      // Simulate compatibility field access hit.
      warnAgentContextCompatFieldOnce({
        field: "test.compat.field",
        replacement: "execution.controllers.runtime.test",
      });
      return {
        output: "ok",
        traces: [],
        turnMessages: [],
        turnTasks: [],
      };
    },
  });

  await runner.runSession({
    userId: "u1",
    sessionId: "s1",
    message: "hello",
    runConfig: {},
    eventListener,
  });

  const compatEvent = events.find((item) => item?.event === "agent_context_compat_field_hits");
  assert.equal(Boolean(compatEvent), true);
  assert.equal(compatEvent?.data?.sessionId, "s1");
  assert.equal(compatEvent?.data?.dialogProcessId, "dp1");
  assert.equal(compatEvent?.data?.fields?.["test.compat.field"], 1);
});

test("SessionExecutionRunner does not let currentSessionModelAlias override selectedModel", async () => {
  let capturedRunConfig = null;
  const runner = createRunner({
    initializeRunSessionRuntime: async ({ eventListener = null } = {}) => ({
      usedSessionId: "s1",
      dialogProcessId: "dp1",
      isContinue: false,
      userConfig: {},
      currentSessionModelAlias: "history-model",
      executionStartIndex: 0,
      runtimeEventListener: eventListener,
    }),
    resolveScenarioRunConfig: (runConfig = {}) => runConfig,
    prepareAgentTurnExecution: async ({ buildContextPayload = {} } = {}) => {
      capturedRunConfig = buildContextPayload.runConfig;
      const runtimeAgentContext = {
        payload: { messages: { history: [] } },
        execution: { controllers: { runtime: { attachmentMetas: [] } } },
      };
      return { agentContext: runtimeAgentContext, runtimeAgentContext };
    },
  });

  await runner.runSession({
    userId: "u1",
    sessionId: "s1",
    message: "hello",
    runConfig: {
      selectedModel: "frontend-model",
      config: { selectedModel: "frontend-model" },
    },
  });

  assert.equal(capturedRunConfig?.selectedModel, "frontend-model");
  assert.equal(capturedRunConfig?.config?.selectedModel, "frontend-model");
  assert.equal(capturedRunConfig?.runtimeModel, undefined);
});
