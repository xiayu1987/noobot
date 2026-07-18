/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { runFunctionCallLoop } from "../../../../src/system-core/agent/core/turn/orchestrator.js";

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

test("when model returns no tool calls, return directly without a retry prompt", async () => {
  const tool = {
    name: "execute_script",
    async invoke() {
      return "{\"ok\":true}";
    },
  };
  const { llm, capturedInvocations, capturedNoToolInvokeOptions } = createToolCallingLlm([
    {
      content: "我先直接回答",
      tool_calls: [],
      additional_kwargs: {},
      response_metadata: {},
    },
    {
      content: "还是直接回答",
      tool_calls: [],
      additional_kwargs: {},
      response_metadata: {},
    },
  ]);

  const events = [];
  const modelState = createModelState(llm);
  modelState.eventListener = {
    onEvent(payload = {}) {
      events.push(payload);
    },
  };
  const loopState = createLoopState({ maxTurns: 3, tool });
  const result = await runFunctionCallLoop({
    modelState,
    loopState,
    turn: 1,
  });

  assert.equal(result.output, "我先直接回答");
  assert.equal(capturedInvocations.length, 1);
  assert.equal(capturedNoToolInvokeOptions[0]?.tool_choice, "auto");
  assert.equal(events.some((item) => item?.event === "tool_choice_required_retry_prompted"), false);
  const retryPrompt = loopState.messageBlocks.incremental.find((messageItem) => {
    const marker =
      messageItem?.additional_kwargs?.noobotInternalMessageType ||
      messageItem?.lc_kwargs?.additional_kwargs?.noobotInternalMessageType ||
      "";
    return marker === "tool_choice_required_retry_prompt";
  });
  assert.equal(retryPrompt, undefined);
  assert.equal(loopState.messageBlocks.incrementalIds, undefined);
});

test("safeConfirm does not force tool calls", async () => {
  const tool = {
    name: "execute_script",
    async invoke() {
      return "{\"ok\":true}";
    },
  };
  const { llm, capturedInvocations } = createToolCallingLlm([
    {
      content: "直接回复即可",
      tool_calls: [],
      additional_kwargs: {},
      response_metadata: {},
    },
  ]);

  const events = [];
  const modelState = createModelState(llm);
  modelState.runtime.systemRuntime.config = { safeConfirm: false };
  modelState.eventListener = {
    onEvent(payload = {}) {
      events.push(payload);
    },
  };
  const result = await runFunctionCallLoop({
    modelState,
    loopState: createLoopState({ maxTurns: 3, tool }),
    turn: 1,
  });

  assert.equal(result.output, "直接回复即可");
  assert.equal(capturedInvocations.length, 1);
  assert.equal(
    events.some((item) => item?.event === "tool_choice_required_retry_prompted"),
    false,
  );
});

test("no-tool response returns immediately without retrying", async () => {
  const tool = {
    name: "execute_script",
    async invoke() {
      return "{\"ok\":true}";
    },
  };
  const { llm, capturedInvocations } = createToolCallingLlm([
    { content: "第一次无工具", tool_calls: [], additional_kwargs: {}, response_metadata: {} },
    { content: "第二次无工具", tool_calls: [], additional_kwargs: {}, response_metadata: {} },
  ]);

  const result = await runFunctionCallLoop({
    modelState: createModelState(llm),
    loopState: createLoopState({ maxTurns: 3, tool }),
    turn: 1,
  });

  assert.equal(result.output, "第一次无工具");
  assert.equal(capturedInvocations.length, 1);
});

test("final_answer tool: next model call uses tool_choice none and exits loop", async () => {
  let toolInvokeCount = 0;
  const tool = {
    name: "final_answer",
    async invoke() {
      toolInvokeCount += 1;
      return "{\"ok\":true,\"message\":\"对话结束请总结\"}";
    },
  };
  const { llm, capturedInvocations, capturedNoToolInvokeOptions } = createToolCallingLlm([
    {
      content: "",
      tool_calls: [{ id: "call_final", name: "final_answer", args: {} }],
      additional_kwargs: {},
      response_metadata: {},
    },
    {
      content: "这是最终总结",
      tool_calls: [{ id: "ignored", name: "execute_script", args: {} }],
      additional_kwargs: {},
      response_metadata: {},
    },
  ]);

  const result = await runFunctionCallLoop({
    modelState: createModelState(llm),
    loopState: createLoopState({ maxTurns: 5, tool }),
    turn: 1,
  });

  assert.equal(toolInvokeCount, 1);
  assert.equal(result.output, "这是最终总结");
  assert.equal(capturedInvocations.length, 2, "should do one tool turn + one final no-tool turn");
  assert.equal(capturedNoToolInvokeOptions[0]?.tool_choice, "auto");
  assert.equal(capturedNoToolInvokeOptions[1]?.tool_choice, "none");
});
