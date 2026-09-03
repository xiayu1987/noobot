/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { runFunctionCallLoop as runFunctionCallLoopProduction } from "../../../src/runtime/turn/orchestrator.js";
import { resolveBoundToolModelRequestOverrides } from "../../../src/runtime/turn/tool-choice-strategy.js";
import { createBoundLlmToolChoiceInvoker } from "../../../src/runtime/turn/tool-invoke-strategy.js";
import { maybeInvokeFinalStreamingNoTools } from "../../../src/runtime/turn/turn-stage.js";
import {
  createTestTurnMessagesStore,
  prepareTestTurnExecution,
} from "./turn-runtime-test-helper.js";
import { createCanonicalMessageEventSessionManager } from "../../helpers/canonical-message-event-session-manager.js";

function runFunctionCallLoop(args = {}) {
  prepareTestTurnExecution(args.modelState, args.loopState, "orchestrator-model-overrides");
  args.loopState.modelContext.activeTurnIdentity = {
    dialogProcessId: "dialog-1",
    turnScopeId: args.modelState.runtime.systemRuntime.turnScopeId,
  };
  return runFunctionCallLoopProduction(args);
}

function delay(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function createToolCallingModelPort(responses = []) {
  const capturedInvocations = [];
  const capturedNoToolInvokeOptions = [];
  let invokeIndex = 0;
  const modelPort = {
    async invoke(request = {}) {
      capturedInvocations.push(request);
      capturedNoToolInvokeOptions.push(request.options?.invoke || {});
      const next = responses[invokeIndex] || responses[responses.length - 1] || {};
      invokeIndex += 1;
      if (next instanceof Error) throw next;
      return {
        output: {
          text: String(next.text ?? next.content ?? ""),
          toolCalls: Array.isArray(next.toolCalls)
            ? next.toolCalls
            : Array.isArray(next.tool_calls)
              ? next.tool_calls
              : [],
        },
      };
    },
  };
  return { modelPort, capturedInvocations, capturedNoToolInvokeOptions };
}

function createLoopState({ maxTurns = 1, tool = null } = {}) {
  return {
    tools: tool ? [tool] : [],
    messages: [],
    messageBlocks: { system: [], history: [], incremental: [] },
    traces: [],
    turnMessages: [],
    turnTasks: [],
    currentTurnMessages: createTestTurnMessagesStore(),
    currentTurnTasks: null,
    dialogProcessId: "dialog-1",
    maxTurns,
    phaseSummaryLoopTurns: 0,
    helpPromptLoopTurns: 0,
    toolFailureHelpCount: 0,
    taskSummaryTriggered: false,
    toolConsecutiveFailureCount: 0,
    errorLogger: null,
  };
}

function createModelState(modelPort, defaultModelSpec = null) {
  const resolvedModelSpec =
    defaultModelSpec && typeof defaultModelSpec === "object"
      ? defaultModelSpec
      : {
          alias: "test_alias",
          model: "test-model",
          reasoning_effort_parameter: "reasoning_effort",
          reasoning_effort_options: ["none", "low", "medium", "high"],
        };
  const modelState = {
    modelPort,
    activeModelName: String(resolvedModelSpec?.model || "test-model"),
    activeModelAlias: String(resolvedModelSpec?.alias || "test_alias"),
    eventListener: null,
    runtime: {
      runConfig: {
        executionId: "run-orchestrator-model-overrides",
      },
      systemRuntime: {
        config: { safeConfirm: true },
      },
    },
    globalConfig: {},
    userConfig: {},
    defaultModelSpec: resolvedModelSpec,
    activeModelSpec: resolvedModelSpec,
    abortSignal: null,
  };
  return modelState;
}

const GPT_REASONING = {
  reasoning_effort_parameter: "reasoning_effort",
  reasoning_effort_options: ["none", "low", "medium", "high", "xhigh"],
};

test("bound tool requests use the configured tool reasoning effort", () => {
  assert.deepEqual(
    resolveBoundToolModelRequestOverrides({
      model: "gpt-5.5",
      ...GPT_REASONING,
      reasoning_effort: "high",
      tool_reasoning_effort: "medium",
    }),
    { reasoning_effort: "medium" },
  );
});

test("bound tool requests fall back to the lowest declared level when tool effort is absent", () => {
  assert.deepEqual(
    resolveBoundToolModelRequestOverrides({
      model: "gpt-5.5",
      reasoning_effort_parameter: "reasoning_effort",
      reasoning_effort_options: ["none", "low", "medium", "high"],
      ...GPT_REASONING,
      reasoning_effort: "high",
    }),
    { reasoning_effort: "none" },
  );
});

test("an unsupported tool effort resolves to the lowest declared level", () => {
  assert.deepEqual(
    resolveBoundToolModelRequestOverrides({
      model: "glm-5.3",
      reasoning_effort_parameter: "reasoning_effort",
      reasoning_effort_options: ["high", "max"],
      tool_reasoning_effort: "invalid",
    }),
    { reasoning_effort: "high" },
  );
});

test("bound tool requests use the provider's declared reasoning parameter", () => {
  assert.deepEqual(
    resolveBoundToolModelRequestOverrides({
      model: "gemini-3.7-flash",
      reasoning_effort_parameter: "thinking_level",
      reasoning_effort_options: ["low", "medium", "high"],
      reasoning_effort: "high",
      tool_reasoning_effort: "medium",
    }),
    { thinking_level: "medium" },
  );
});

test("a switch-shaped reasoning parameter carries a boolean for bound tool rounds", () => {
  const qwen = {
    model: "qwen3.7-plus",
    reasoning_effort_parameter: "enable_thinking",
    reasoning_effort_options: ["none", "medium"],
  };
  assert.deepEqual(
    resolveBoundToolModelRequestOverrides({ ...qwen, tool_reasoning_effort: "medium" }),
    {
      enable_thinking: true,
    },
  );
  assert.deepEqual(
    resolveBoundToolModelRequestOverrides({ ...qwen, tool_reasoning_effort: "none" }),
    {
      enable_thinking: false,
    },
  );
});

test("bound tool openai_compatible request overrides are passed to invoke options", async () => {
  const tool = {
    name: "execute_script",
    async invoke() {
      return '{"ok":true}';
    },
  };
  const { modelPort, capturedNoToolInvokeOptions } = createToolCallingModelPort([
    {
      content: "完成",
      tool_calls: [],
      additional_kwargs: {},
      response_metadata: {},
    },
  ]);

  const result = await runFunctionCallLoop({
    modelState: createModelState(modelPort, {
      model: "gpt-5.5",
      reasoning_effort_parameter: "reasoning_effort",
      reasoning_effort_options: ["none", "low", "medium", "high"],
      ...GPT_REASONING,
      reasoning_effort: "high",
    }),
    loopState: createLoopState({ maxTurns: 1, tool }),
    turn: 1,
  });

  assert.equal(capturedNoToolInvokeOptions[0]?.tool_choice, "auto");
  assert.equal(capturedNoToolInvokeOptions[0]?.reasoning_effort, "none");
  assert.equal(result.output, "完成");
});

test("bound tool overrides use active model spec when it differs from default spec", async () => {
  const { modelPort, capturedNoToolInvokeOptions } = createToolCallingModelPort([
    {
      content: "完成",
      tool_calls: [],
      additional_kwargs: {},
      response_metadata: {},
    },
  ]);
  const modelState = createModelState(modelPort, {
    model: "qwen3.6-plus",
    reasoning_effort_parameter: "enable_thinking",
    reasoning_effort_options: ["none", "medium"],
  });
  modelState.activeModelSpec = {
    model: "gpt-5.5",
    ...GPT_REASONING,
    reasoning_effort: "high",
  };
  const invokeBoundLlmWithToolChoice = createBoundLlmToolChoiceInvoker({
    adaptedBinding: { bindOptions: { tool_choice: "auto" } },
    boundTools: [{ name: "execute_script" }],
    messages: [],
    modelState,
    runtime: modelState.runtime,
    abortSignal: null,
    turn: 1,
  });

  await invokeBoundLlmWithToolChoice("auto");

  assert.equal(capturedNoToolInvokeOptions[0]?.reasoning_effort, "none");
});

test("bound tool invocations are non-streaming across tool rounds", async () => {
  const { modelPort, capturedInvocations } = createToolCallingModelPort([
    { content: "", tool_calls: [] },
    { content: "", tool_calls: [] },
  ]);
  const modelState = createModelState(modelPort);
  modelState.runtime.runConfig.streaming = false;
  modelState.globalConfig.streaming = true;
  const invokeBoundLlmWithToolChoice = createBoundLlmToolChoiceInvoker({
    adaptedBinding: { bindOptions: { tool_choice: "auto" } },
    boundTools: [{ name: "execute_script" }],
    messages: [],
    modelState,
    runtime: modelState.runtime,
    abortSignal: null,
  });

  await invokeBoundLlmWithToolChoice();
  await invokeBoundLlmWithToolChoice();

  assert.deepEqual(
    capturedInvocations.map((request) => request.options?.streaming),
    [false, false],
  );
});

test("bound tool invocations remain non-streaming when frontend enables streaming", async () => {
  const { modelPort, capturedInvocations } = createToolCallingModelPort([
    { content: "", tool_calls: [] },
    { content: "", tool_calls: [] },
  ]);
  const modelState = createModelState(modelPort);
  modelState.globalConfig.streaming = true;
  const invokeBoundLlmWithToolChoice = createBoundLlmToolChoiceInvoker({
    adaptedBinding: { bindOptions: { tool_choice: "auto" } },
    boundTools: [{ name: "execute_script" }],
    messages: [],
    modelState,
    runtime: modelState.runtime,
    abortSignal: null,
  });

  await invokeBoundLlmWithToolChoice();
  await invokeBoundLlmWithToolChoice();

  assert.deepEqual(
    capturedInvocations.map((request) => request.options?.streaming),
    [false, false],
  );
});

test("only the final no-tools streaming stage owns delta callbacks", async () => {
  const events = [];
  const capturedInvocations = [];
  const runtime = {
    runConfig: { streaming: true },
    systemRuntime: {},
    sessionManager: createCanonicalMessageEventSessionManager(),
  };
  const eventListener = {
    onEvent(payload = {}) {
      events.push(payload);
    },
  };
  const modelPort = {
    async invoke(request = {}) {
      capturedInvocations.push(request);
      if (request.options?.streaming === true) {
        const [callback] = request.options.callbacks || [];
        await callback?.handleLLMNewToken?.("final ");
        await callback?.handleLLMNewToken?.("answer");
        await callback?.handleLLMEnd?.();
      }
      return {
        output: {
          text: request.options?.streaming === true ? "final answer" : "tool-free draft",
          toolCalls: [],
        },
      };
    },
  };
  const modelState = {
    modelPort,
    runtime,
    eventListener,
    globalConfig: {},
    userConfig: {},
    defaultModelSpec: { ...GPT_REASONING },
    activeModelSpec: { ...GPT_REASONING },
    abortSignal: null,
  };
  prepareTestTurnExecution(modelState, createLoopState(), "final-stream-callback-owner");
  const invokeBoundLlmWithToolChoice = createBoundLlmToolChoiceInvoker({
    adaptedBinding: { bindOptions: { tool_choice: "auto" } },
    boundTools: [{ name: "execute_script" }],
    messages: [{ role: "user", content: "run and answer" }],
    modelState,
    runtime,
    abortSignal: null,
  });

  await invokeBoundLlmWithToolChoice();
  const result = await maybeInvokeFinalStreamingNoTools({
    modelState,
    baseMessages: [{ role: "user", content: "run and answer" }],
    fallbackText: "tool-free draft",
    turn: 2,
  });

  assert.deepEqual(
    capturedInvocations.map((request) => request.options?.streaming),
    [false, true],
  );
  assert.equal(Object.hasOwn(capturedInvocations[0].options, "callbacks"), false);
  assert.equal(Array.isArray(capturedInvocations[1].options.callbacks), true);
  assert.equal(result.text, "final answer");
  assert.deepEqual(
    events
      .filter((item) => item?.event === "authority_event_committed")
      .map((item) => item?.data?.envelope?.payload)
      .filter((payload) => payload?.eventType === "llm_delta")
      .map((payload) => payload.text),
    ["final ", "answer"],
  );
});
