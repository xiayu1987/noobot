/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ChatOpenAI } from "@langchain/openai";

import { runFunctionCallLoop } from "../../../../src/system-core/agent/core/turn/orchestrator.js";
import {
  applyBoundToolModelRequestOverridesToLlm,
  resolveBoundToolModelRequestOverrides,
} from "../../../../src/system-core/agent/core/turn/tool-choice-strategy.js";
import { createBoundLlmToolChoiceInvoker } from "../../../../src/system-core/agent/core/turn/tool-invoke-strategy.js";

function delay(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function createToolCallingLlm(responses = []) {
  const capturedInvocations = [];
  const capturedBindOptions = [];
  const capturedNoToolInvokeOptions = [];
  let invokeIndex = 0;
  const llm = {
    bindTools(_tools = [], bindOptions = {}) {
      capturedBindOptions.push(bindOptions);
      return {
        async invoke(messages = [], options = {}) {
          capturedInvocations.push(messages);
          capturedNoToolInvokeOptions.push(options);
          const next = responses[invokeIndex] || responses[responses.length - 1] || {};
          invokeIndex += 1;
          if (next instanceof Error) throw next;
          return next;
        },
      };
    },
    async invoke(messages = [], options = {}) {
      capturedInvocations.push(messages);
      capturedNoToolInvokeOptions.push(options);
      const next = responses[invokeIndex] || responses[responses.length - 1] || {};
      invokeIndex += 1;
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { llm, capturedInvocations, capturedBindOptions, capturedNoToolInvokeOptions };
}

function createLoopState({ maxTurns = 1, tool = null } = {}) {
  return {
    tools: tool ? [tool] : [],
    messages: [],
    messageBlocks: { system: [], history: [], incremental: [] },
    traces: [],
    turnMessages: [],
    turnTasks: [],
    currentTurnMessages: null,
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

function createModelState(llm, defaultModelSpec = null) {
  const resolvedModelSpec =
    defaultModelSpec && typeof defaultModelSpec === "object"
      ? defaultModelSpec
      : { alias: "test_alias", model: "test-model" };
  return {
    llm,
    activeModelName: String(resolvedModelSpec?.model || "test-model"),
    activeModelAlias: String(resolvedModelSpec?.alias || "test_alias"),
    eventListener: null,
    runtime: {
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
      return "{\"ok\":true}";
    },
  };
  const { llm, capturedNoToolInvokeOptions } = createToolCallingLlm([
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
    modelState: createModelState(llm, { format: "dashscope", model: "qwen3.6-plus" }),
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

test("bound ChatOpenAI request params force openai_compatible reasoning_effort low", () => {
  const tool = {
    type: "function",
    function: {
      name: "execute_script",
      description: "execute script",
      parameters: { type: "object", properties: {} },
    },
  };
  const llm = new ChatOpenAI({
    apiKey: "test-key",
    configuration: { baseURL: "http://localhost" },
    model: "gpt-5.5",
    modelKwargs: { reasoning_effort: "high" },
    reasoning: { effort: "high" },
  });
  const bound = llm.bindTools([tool]);

  applyBoundToolModelRequestOverridesToLlm(bound, { reasoning_effort: "low" });

  assert.equal(llm.invocationParams({}).reasoning_effort, "high");
  assert.equal(bound.invocationParams({}).reasoning_effort, "low");
});

test("bound ChatOpenAI request params force dashscope thinking off", () => {
  const tool = {
    type: "function",
    function: {
      name: "execute_script",
      description: "execute script",
      parameters: { type: "object", properties: {} },
    },
  };
  const llm = new ChatOpenAI({
    apiKey: "test-key",
    configuration: { baseURL: "http://localhost" },
    model: "qwen3.6-plus",
    modelKwargs: { preserve_thinking: true, thinking_budget: 1024 },
  });
  const bound = llm.bindTools([tool]);

  applyBoundToolModelRequestOverridesToLlm(bound, {
    preserve_thinking: false,
    thinking_budget: 0,
  });

  assert.equal(llm.invocationParams({}).preserve_thinking, true);
  assert.equal(llm.invocationParams({}).thinking_budget, 1024);
  assert.equal(bound.invocationParams({}).preserve_thinking, false);
  assert.equal(bound.invocationParams({}).thinking_budget, 0);
});

test("bound tool openai_compatible request overrides are passed to invoke options", async () => {
  const tool = {
    name: "execute_script",
    async invoke() {
      return "{\"ok\":true}";
    },
  };
  const { llm, capturedNoToolInvokeOptions } = createToolCallingLlm([
    {
      content: "完成",
      tool_calls: [],
      additional_kwargs: {},
      response_metadata: {},
    },
  ]);

  const result = await runFunctionCallLoop({
    modelState: createModelState(llm, {
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
  const { llm, capturedNoToolInvokeOptions } = createToolCallingLlm([
    {
      content: "完成",
      tool_calls: [],
      additional_kwargs: {},
      response_metadata: {},
    },
  ]);
  const modelState = createModelState(llm, { format: "dashscope", model: "qwen3.6-plus" });
  modelState.activeModelSpec = {
    format: "openai_compatible",
    model: "gpt-5.5",
    reasoning_effort: "high",
  };
  const invokeBoundLlmWithToolChoice = createBoundLlmToolChoiceInvoker({
    adaptedBinding: { bindOptions: { tool_choice: "auto" } },
    boundTools: [{ name: "execute_script" }],
    invokeLlm: llm,
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
