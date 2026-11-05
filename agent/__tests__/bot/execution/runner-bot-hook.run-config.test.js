/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import { createTestRuntimeContext } from "../../helpers/test-runtime-context.js";
import assert from "node:assert/strict";
import {
  ACCEPTED_TURN_STARTED_AT,
  createRunner,
  createTestAgentExecutionScope,
} from "./runner-bot-hook.fixtures.js";

test("SessionExecutionRunner does not let currentSessionModelAlias override selectedModel", async () => {
  let capturedRunConfig = null;
  const runner = createRunner({
    initializeRunSessionRuntime: async ({ eventListener = null, parentSessionId } = {}) => ({
      parentSessionId,
      usedSessionId: "s1",
      dialogProcessId: "dp1",
      startedAt: ACCEPTED_TURN_STARTED_AT,
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
      startedAt: ACCEPTED_TURN_STARTED_AT,
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

test("SessionExecutionRunner finalizes with the accepted Turn startedAt, not runConfig", async () => {
  let capturedFinalizePayload = null;
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
    runConfig: {},
  });

  assert.equal(Object.hasOwn(capturedFinalizePayload, "thinkingStartedAt"), false);
  assert.equal(capturedFinalizePayload?.startedAt, ACCEPTED_TURN_STARTED_AT);
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
