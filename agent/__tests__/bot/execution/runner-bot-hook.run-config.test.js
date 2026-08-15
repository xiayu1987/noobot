/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  createRunner,
  createTestBotHookManager,
  createCanonicalHandledResult,
  HOOK_POINT,
  createAgentCapabilityModelInvoker,
  createBotDispatchHandled,
  createTestAgentExecutionScope,
} from "./runner-bot-hook.fixtures.js";

test("SessionExecutionRunner does not let currentSessionModelAlias override selectedModel", async () => {
  let capturedRunConfig = null;
  const runner = createRunner({
    initializeRunSessionRuntime: async ({ eventListener = null } = {}) => ({
      usedSessionId: "s1",
      dialogProcessId: "dp1",
      sessionLoadState: "created",
      userConfig: {},
      currentSessionModelAlias: "history-model",
      executionStartIndex: 0,
      runtimeEventListener: eventListener,
    }),
    resolveScenarioRunConfig: (runConfig = {}) => runConfig,
    prepareAgentTurnExecution: async ({ buildContextPayload = {} } = {}) => {
      capturedRunConfig = buildContextPayload.runConfig;
      const runtimeAgentContext = createTestAgentExecutionScope({ attachmentMetas: [] });
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

test("SessionExecutionRunner restores currentSessionModelAlias when selectedModel is absent", async () => {
  let capturedRunConfig = null;
  const runner = createRunner({
    initializeRunSessionRuntime: async ({ eventListener = null } = {}) => ({
      usedSessionId: "s1",
      dialogProcessId: "dp1",
      sessionLoadState: "loaded",
      userConfig: {},
      currentSessionModelAlias: "history-model",
      executionStartIndex: 0,
      runtimeEventListener: eventListener,
    }),
    resolveScenarioRunConfig: (runConfig = {}) => runConfig,
    prepareAgentTurnExecution: async ({ buildContextPayload = {} } = {}) => {
      capturedRunConfig = buildContextPayload.runConfig;
      const runtimeAgentContext = createTestAgentExecutionScope({ attachmentMetas: [] });
      return { agentContext: runtimeAgentContext, runtimeAgentContext };
    },
  });

  await runner.runSession({
    userId: "u1",
    sessionId: "s1",
    message: "hello",
    runConfig: {},
  });

  assert.equal(capturedRunConfig?.runtimeModel, "history-model");
});

test("SessionExecutionRunner preserves provided thinkingStartedAt", async () => {
  let capturedFinalizePayload = null;
  const providedThinkingStartedAt = "2026-01-02T03:04:05.006Z";
  const runner = createRunner({});
  runner.finalizeRunSession = async (payload = {}) => {
    capturedFinalizePayload = payload;
    return { answer: "ok" };
  };

  await runner.runSession({
    userId: "u1",
    sessionId: "s1",
    message: "hello",
    runConfig: { thinkingStartedAt: providedThinkingStartedAt },
  });

  assert.equal(capturedFinalizePayload?.thinkingStartedAt, providedThinkingStartedAt);
});
