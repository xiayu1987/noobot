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
import {
  createTestTurnMessagesStore,
  prepareTestTurnExecution,
} from "./turn-runtime-test-helper.js";

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
      : { alias: "test_alias", model: "test-model" };
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

test("bound tool dashscope request overrides disable thinking", () => {
  assert.deepEqual(
    resolveBoundToolModelRequestOverrides({
      format: "dashscope",
      model: "qwen3.6-plus",
      preserve_thinking: true,
      thinking_budget: 4096,
    }),
    { preserve_thinking: false, thinking_budget: 0 },
  );
});

test("auto tool_choice should apply bound tool dashscope request overrides", async () => {
  let toolInvokeCount = 0;
  const tool = {
    name: "execute_script",
    async invoke() {
      toolInvokeCount += 1;
      return '{"ok":true}';
    },
  };
  const { modelPort, capturedNoToolInvokeOptions } = createToolCallingModelPort([
    {
      content: "",
      tool_calls: [{ id: "call_1", name: "execute_script", args: {} }],
      additional_kwargs: {},
      response_metadata: {},
    },
    {
      content: "收尾结果",
      tool_calls: [],
      additional_kwargs: {},
      response_metadata: {},
    },
  ]);

  const result = await runFunctionCallLoop({
    modelState: createModelState(modelPort, { format: "dashscope", model: "qwen3.6-plus" }),
    loopState: createLoopState({ maxTurns: 1, tool }),
    turn: 1,
  });

  assert.equal(toolInvokeCount, 1);
  assert.equal(capturedNoToolInvokeOptions[0]?.tool_choice, "auto");
  assert.equal(capturedNoToolInvokeOptions[1]?.tool_choice, "auto");
  assert.equal(capturedNoToolInvokeOptions[1]?.enable_thinking, false);
  assert.equal(capturedNoToolInvokeOptions[1]?.preserve_thinking, false);
  assert.equal(capturedNoToolInvokeOptions[1]?.thinking_budget, 0);
  assert.equal(result.output, "收尾结果");
});

test("bound tool requests use openai_compatible tool_reasoning_effort when configured", () => {
  assert.deepEqual(
    resolveBoundToolModelRequestOverrides({
      format: "openai_compatible",
      model: "gpt-5.5",
      reasoning_effort: "high",
      tool_reasoning_effort: "medium",
    }),
    { reasoning_effort: "medium" },
  );
});

test("bound tool requests default openai_compatible reasoning_effort to low", () => {
  assert.deepEqual(
    resolveBoundToolModelRequestOverrides({
      format: "openai_compatible",
      model: "gpt-5.5",
      reasoning_effort: "high",
    }),
    { reasoning_effort: "low" },
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
      format: "openai_compatible",
      model: "gpt-5.5",
      reasoning_effort: "high",
    }),
    loopState: createLoopState({ maxTurns: 1, tool }),
    turn: 1,
  });

  assert.equal(capturedNoToolInvokeOptions[0]?.tool_choice, "auto");
  assert.equal(capturedNoToolInvokeOptions[0]?.reasoning_effort, "low");
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
  const modelState = createModelState(modelPort, { format: "dashscope", model: "qwen3.6-plus" });
  modelState.activeModelSpec = {
    format: "openai_compatible",
    model: "gpt-5.5",
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

  assert.equal(capturedNoToolInvokeOptions[0]?.reasoning_effort, "low");
  assert.equal(capturedNoToolInvokeOptions[0]?.preserve_thinking, undefined);
  assert.equal(capturedNoToolInvokeOptions[0]?.thinking_budget, undefined);
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
