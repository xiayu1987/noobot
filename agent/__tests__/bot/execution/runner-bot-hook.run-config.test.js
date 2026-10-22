/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import { createTestRuntimeContext } from "../../helpers/test-runtime-context.js";
import assert from "node:assert/strict";
import { createRunner, createTestAgentExecutionScope } from "./runner-bot-hook.fixtures.js";

test("SessionExecutionRunner does not let currentSessionModelAlias override selectedModel", async () => {
  let capturedRunConfig = null;
  const runner = createRunner({
    initializeRunSessionRuntime: async ({ eventListener = null, parentSessionId } = {}) => ({
      parentSessionId,
      usedSessionId: "s1",
      dialogProcessId: "dp1",
      sessionLoadState: "created",
      userConfig: {},
      currentSessionModelAlias: "history-model",
      runtimeEventListener: eventListener,
    }),
    resolveScenarioRunConfig: (runConfig = {}) => runConfig,
    prepareAgentTurnExecution: async ({ buildContextPayload = {} } = {}) => {
      capturedRunConfig = buildContextPayload.runConfig;
      const runtimeAgentContext = createTestAgentExecutionScope(createTestRuntimeContext());
      return { agentContext: runtimeAgentContext, userMessageAttachments: [] };
    },
  });

  await runner.runAcceptedSession({
    turnScopeId: "turn-default",
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
    initializeRunSessionRuntime: async ({ eventListener = null, parentSessionId } = {}) => ({
      parentSessionId,
      usedSessionId: "s1",
      dialogProcessId: "dp1",
      sessionLoadState: "loaded",
      userConfig: {},
      currentSessionModelAlias: "history-model",
      runtimeEventListener: eventListener,
    }),
    resolveScenarioRunConfig: (runConfig = {}) => runConfig,
    prepareAgentTurnExecution: async ({ buildContextPayload = {} } = {}) => {
      capturedRunConfig = buildContextPayload.runConfig;
      const runtimeAgentContext = createTestAgentExecutionScope(createTestRuntimeContext());
      return { agentContext: runtimeAgentContext, userMessageAttachments: [] };
    },
  });

  await runner.runAcceptedSession({
    turnScopeId: "turn-default",
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

  await runner.runAcceptedSession({
    turnScopeId: "turn-default",
    userId: "u1",
    sessionId: "s1",
    message: "hello",
    runConfig: { thinkingStartedAt: providedThinkingStartedAt },
  });

  assert.equal(capturedFinalizePayload?.thinkingStartedAt, providedThinkingStartedAt);
});

test("SessionExecutionRunner disposes the plugin activation scope exactly once after success", async () => {
  let disposeCalls = 0;
  const pluginActivationScope = {
    dispose() {
      disposeCalls += 1;
    },
  };
  const runner = createRunner({
    prepareRunConfig: ({ runConfig = {} } = {}) => ({
      ...runConfig,
      botHookManager: null,
      turnScopeId: runConfig.turnScopeId || "turn-plugin-scope-success",
      pluginActivationScope,
    }),
  });

  await runner.runAcceptedSession({
    turnScopeId: "turn-default",
    userId: "u1",
    sessionId: "s1",
    message: "hello",
    runConfig: {},
  });

  assert.equal(disposeCalls, 1);
});

test("SessionExecutionRunner disposes the plugin activation scope exactly once after failure", async () => {
  let disposeCalls = 0;
  const pluginActivationScope = {
    dispose() {
      disposeCalls += 1;
    },
  };
  const runner = createRunner({
    prepareRunConfig: ({ runConfig = {} } = {}) => ({
      ...runConfig,
      botHookManager: null,
      turnScopeId: runConfig.turnScopeId || "turn-plugin-scope-failure",
      pluginActivationScope,
    }),
    agentRunner: async () => {
      throw new Error("plugin scope failure path");
    },
  });

  await assert.rejects(
    () =>
      runner.runAcceptedSession({
        turnScopeId: "turn-default",
        userId: "u1",
        sessionId: "s1",
        message: "hello",
        runConfig: {},
      }),
    /plugin scope failure path/,
  );

  assert.equal(disposeCalls, 1);
});
