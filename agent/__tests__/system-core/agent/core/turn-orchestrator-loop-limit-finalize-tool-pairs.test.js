/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { HumanMessage } from "@langchain/core/messages";

import { runFunctionCallLoop } from "../../../../src/system-core/agent/core/turn/orchestrator.js";
import { createAgentHookManager } from "../../../../src/system-core/hook/index.js";

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

test("completed tool loop keeps matching tool_call and tool_result in turnMessages", async () => {
  const tool = {
    name: "execute_script",
    async invoke() {
      return "{\"ok\":true}";
    },
  };
  const { llm } = createToolCallingLlm([
    {
      content: "",
      tool_calls: [{ id: "call_pair_1", name: "execute_script", args: { command: "true" } }],
      additional_kwargs: {},
      response_metadata: {},
    },
    {
      content: "完成",
      tool_calls: [],
      additional_kwargs: {},
      response_metadata: {},
    },
  ]);

  const result = await runFunctionCallLoop({
    modelState: createModelState(llm),
    loopState: createLoopState({ maxTurns: 3, tool }),
    turn: 1,
  });

  const callMessage = result.turnMessages.find(
    (item = {}) => item?.role === "assistant" && item?.type === "tool_call",
  );
  const resultMessage = result.turnMessages.find(
    (item = {}) => item?.role === "tool" && item?.type === "tool_result",
  );
  assert.ok(callMessage, "assistant tool_call must survive into the final turnMessages");
  assert.ok(resultMessage, "tool_result must survive into the final turnMessages");
  assert.equal(callMessage.tool_calls?.[0]?.id, "call_pair_1");
  assert.equal(resultMessage.tool_call_id, "call_pair_1");
});

test("multiple tool calls stay in one tool turn and advance loop turns by tool count", async () => {
  const invokedArgs = [];
  const toolTimings = [];
  const tool = {
    name: "execute_script",
    async invoke(args = {}) {
      const startedAt = Date.now();
      invokedArgs.push(args);
      await delay(args.delayMs);
      toolTimings.push({ value: args.value, startedAt, endedAt: Date.now() });
      return JSON.stringify({ ok: true, value: args.value });
    },
  };
  const { llm, capturedInvocations } = createToolCallingLlm([
    {
      content: "检查多个文件",
      tool_calls: [
        { id: "call_1", name: "execute_script", args: { value: 1, delayMs: 60 } },
        { id: "call_2", name: "execute_script", args: { value: 2, delayMs: 5 } },
        { id: "call_3", name: "execute_script", args: { value: 3, delayMs: 20 } },
      ],
      additional_kwargs: {},
      response_metadata: {},
    },
    {
      content: "完成",
      tool_calls: [],
      additional_kwargs: {},
      response_metadata: {},
    },
  ]);

  const loopState = createLoopState({ maxTurns: 10, tool });
  const modelState = createModelState(llm);
  const hookManager = createAgentHookManager();
  const beforeLlmContexts = [];
  const afterLlmContexts = [];
  const beforeToolCallContexts = [];
  const afterToolCallContexts = [];
  hookManager.on("before_llm_call", (ctx = {}) => beforeLlmContexts.push(ctx));
  hookManager.on("after_llm_call", (ctx = {}) => afterLlmContexts.push(ctx));
  hookManager.on("before_tool_calls", (ctx = {}) => beforeToolCallContexts.push(ctx));
  hookManager.on("after_tool_calls", (ctx = {}) => afterToolCallContexts.push(ctx));
  modelState.runtime.hookManager = hookManager;
  modelState.runtime.systemRuntime.config = { safeConfirm: false };
  const result = await runFunctionCallLoop({
    modelState,
    loopState,
    turn: 1,
  });

  assert.equal(result.output, "完成");
  assert.deepEqual(invokedArgs, [
    { value: 1, delayMs: 60 },
    { value: 2, delayMs: 5 },
    { value: 3, delayMs: 20 },
  ]);
  assert.equal(
    Math.max(...toolTimings.map((item) => item.startedAt)) -
      Math.min(...toolTimings.map((item) => item.startedAt)) < 45,
    true,
    "multiple tools should start in parallel",
  );
  assert.deepEqual(
    toolTimings.map((item) => item.value),
    [2, 3, 1],
    "shorter tools should be able to finish before earlier calls",
  );
  assert.equal(capturedInvocations.length, 2);

  const toolCallMessages = loopState.turnMessages.filter(
    (item) => item.role === "assistant" && item.type === "tool_call",
  );
  const toolResultMessages = loopState.turnMessages.filter((item) => item.role === "tool");
  const userPromptMessages = loopState.turnMessages.filter((item) => item.role === "user");
  assert.equal(toolCallMessages.length, 1);
  assert.equal(toolResultMessages.length, 3);
  assert.deepEqual(
    toolCallMessages[0].tool_calls.map((call) => call.id),
    ["call_1", "call_2", "call_3"],
  );
  assert.deepEqual(
    toolResultMessages.map((item) => item.tool_call_id),
    ["call_1", "call_2", "call_3"],
  );
  assert.equal(
    userPromptMessages.some((item = {}) =>
      /不要一次返回 3 条及以上工具|do not return 3 or more at once/i.test(
        String(item?.content || ""),
      )),
    false,
    "tool-batch-limit prompt should be model-context-only and not appear in frontend turn messages",
  );

  const secondInvocationMessages = capturedInvocations[1] || [];
  assert.equal(
    secondInvocationMessages.some((messageItem) =>
      messageItem instanceof HumanMessage &&
      /不要一次返回 3 条及以上工具|do not return 3 or more at once/i.test(
        String(messageItem?.content || ""),
      )),
    false,
    "split synthetic batches should no longer inject tool-batch-limit prompts",
  );
  const assistantToolCallCounts = secondInvocationMessages
    .filter((message) => String(message?._getType?.() || "") === "ai")
    .map((message) => (Array.isArray(message.tool_calls) ? message.tool_calls.length : 0));
  assert.equal(assistantToolCallCounts.at(-1), 3);
  const incrementalToolCallIds = loopState.messageBlocks.incremental
    .filter((message) => Array.isArray(message?.tool_calls))
    .flatMap((message) => message.tool_calls.map((call) => call.id).filter(Boolean));
  assert.deepEqual(incrementalToolCallIds.slice(-3), ["call_1", "call_2", "call_3"]);
  const incrementalToolResultIds = loopState.messageBlocks.incremental
    .filter((message) => String(message?._getType?.() || "") === "tool")
    .map((message) => message.tool_call_id)
    .filter(Boolean);
  assert.deepEqual(incrementalToolResultIds.slice(-3), ["call_1", "call_2", "call_3"]);
  assert.ok(
    loopState.messageBlocks.incremental
      .slice(-6)
      .every((message) => message.additional_kwargs?.noobotMessageId),
  );

  const syntheticBeforeLlm = beforeLlmContexts.filter((ctx) => ctx?.fakeTurn === true);
  const syntheticAfterLlm = afterLlmContexts.filter((ctx) => ctx?.fakeTurn === true);
  const syntheticBeforeToolCalls = beforeToolCallContexts.filter((ctx) => ctx?.fakeTurn === true);
  const syntheticAfterToolCalls = afterToolCallContexts.filter((ctx) => ctx?.fakeTurn === true);
  assert.equal(syntheticBeforeLlm.length, 0);
  assert.equal(syntheticAfterLlm.length, 0);
  assert.equal(syntheticBeforeToolCalls.length, 0);
  assert.equal(syntheticAfterToolCalls.length, 0);
  assert.deepEqual(
    beforeLlmContexts.map((ctx) => ctx.turn),
    [1, 4],
  );
  assert.equal(beforeToolCallContexts.length, 1);
  assert.equal(afterToolCallContexts.length, 1);
  assert.equal(beforeToolCallContexts[0].toolCallCount, 3);
  assert.equal(afterToolCallContexts[0].toolCallCount, 3);
});
