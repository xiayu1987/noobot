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

test("loop over max turns: inject finalize prompt, allow 5-turn buffer, then no-tools finalize if still asks tools", async () => {
  let toolInvokeCount = 0;
  const tool = {
    name: "execute_script",
    async invoke() {
      toolInvokeCount += 1;
      return "{\"ok\":true}";
    },
  };
  const { llm, capturedInvocations, capturedNoToolInvokeOptions } = createToolCallingLlm([
    {
      content: "",
      tool_calls: [{ id: "call_1", name: "execute_script", args: {} }],
      additional_kwargs: {},
      response_metadata: {},
    },
    {
      content: "",
      tool_calls: [{ id: "call_2", name: "execute_script", args: {} }],
      additional_kwargs: {},
      response_metadata: {},
    },
    {
      content: "",
      tool_calls: [{ id: "call_3", name: "execute_script", args: {} }],
      additional_kwargs: {},
      response_metadata: {},
    },
    {
      content: "",
      tool_calls: [{ id: "call_4", name: "execute_script", args: {} }],
      additional_kwargs: {},
      response_metadata: {},
    },
    {
      content: "",
      tool_calls: [{ id: "call_5", name: "execute_script", args: {} }],
      additional_kwargs: {},
      response_metadata: {},
    },
    {
      content: "",
      tool_calls: [{ id: "call_6", name: "execute_script", args: {} }],
      additional_kwargs: {},
      response_metadata: {},
    },
    {
      content: "最终总结",
      tool_calls: [],
      additional_kwargs: {},
      response_metadata: {},
    },
  ]);

  const loopState = createLoopState({ maxTurns: 1, tool });
  const result = await runFunctionCallLoop({
    modelState: createModelState(llm),
    loopState,
    turn: 1,
  });

  assert.equal(toolInvokeCount, 6, "should execute initial turn plus 5 over-limit buffer turns");
  assert.equal(result.output, "最终总结");
  assert.equal(capturedInvocations.length, 7);
  assert.equal(capturedNoToolInvokeOptions[1]?.tool_choice, "auto");
  assert.equal(capturedNoToolInvokeOptions[6]?.tool_choice, "none");
  const secondInvocationMessages = capturedInvocations[1] || [];
  const finalizePromptMessage = [...secondInvocationMessages]
    .reverse()
    .find((messageItem) => messageItem instanceof HumanMessage);
  assert.ok(finalizePromptMessage);
  assert.match(
    String(finalizePromptMessage.content || ""),
    /停止继续调用工具|Stop calling tools|toolLoopLimitFinalizePrompt/i,
  );
  const promptInBlocks = loopState.messageBlocks.incremental.find(
    (message) => message === finalizePromptMessage,
  );
  assert.equal(promptInBlocks, finalizePromptMessage);
  assert.ok(finalizePromptMessage.additional_kwargs.noobotMessageId);
  assert.equal(loopState.messageBlocks.incrementalIds, undefined);
});

test("phaseSummaryNoToolsNextTurn enforces one no-tools round even when tools are available", async () => {
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
      content: "overflow fallback answer",
      tool_calls: [],
      additional_kwargs: {},
      response_metadata: {},
    },
  ]);

  const modelState = createModelState(llm);
  modelState.runtime.systemRuntime.phaseSummaryNoToolsNextTurn = true;
  const result = await runFunctionCallLoop({
    modelState,
    loopState: createLoopState({ maxTurns: 3, tool }),
    turn: 1,
  });

  assert.equal(result.output, "overflow fallback answer");
  assert.equal(toolInvokeCount, 0);
  assert.equal(capturedNoToolInvokeOptions[0]?.tool_choice, "none");
  assert.equal(modelState.runtime.systemRuntime.phaseSummaryNoToolsNextTurn, false);
});

test("main flow final-no-tools instruction from before_llm hook skips with-tools model call", async () => {
  let toolInvokeCount = 0;
  const tool = {
    name: "execute_script",
    async invoke() {
      toolInvokeCount += 1;
      return "{\"ok\":true}";
    },
  };
  const { llm, capturedInvocations, capturedNoToolInvokeOptions } = createToolCallingLlm([
    {
      content: "final after harness overflow instruction",
      tool_calls: [{ id: "ignored", name: "execute_script", args: {} }],
      additional_kwargs: {},
      response_metadata: {},
    },
  ]);

  const modelState = createModelState(llm);
  const hookManager = createAgentHookManager();
  hookManager.on("before_llm_call", (ctx = {}) => {
    if (ctx.mode !== "with_tools") return;
    modelState.runtime.systemRuntime.mainFlowControlInstruction = {
      action: "final_no_tools_turn",
      reason: "context_overflow_after_summary",
      source: "harness_summary_overflow",
    };
  });
  modelState.runtime.hookManager = hookManager;

  const result = await runFunctionCallLoop({
    modelState,
    loopState: createLoopState({ maxTurns: 3, tool }),
    turn: 1,
  });

  assert.equal(result.output, "final after harness overflow instruction");
  assert.equal(toolInvokeCount, 0);
  assert.equal(capturedInvocations.length, 1, "with-tools LLM call should be skipped");
  assert.equal(capturedNoToolInvokeOptions[0]?.tool_choice, "none");
  assert.equal(modelState.runtime.systemRuntime.mainFlowControlInstruction, undefined);
  assert.equal(modelState.runtime.systemRuntime.mainFlowFinalNoToolsTurnActive, false);
});

test("post-summary char overflow enters final no-tools before the next with-tools model call", async () => {
  let toolInvokeCount = 0;
  const taskSummaryTool = {
    name: "task_summary",
    async invoke() {
      toolInvokeCount += 1;
      return "{\"ok\":true}";
    },
  };
  const longUserMessage = { role: "user", content: "x".repeat(32), summarized: false };
  const { llm, capturedInvocations, capturedNoToolInvokeOptions } = createToolCallingLlm([
    {
      content: "final after post-summary overflow",
      tool_calls: [{ id: "ignored", name: "task_summary", args: { summaryContent: "ignored" } }],
      additional_kwargs: {},
      response_metadata: {},
    },
  ]);

  const loopState = createLoopState({ maxTurns: 3, tool: taskSummaryTool });
  loopState.phaseSummaryMessageCharsThreshold = 10;
  loopState.messages.push(longUserMessage);
  loopState.messageBlocks.incremental.push(longUserMessage);

  const modelState = createModelState(llm);
  modelState.runtime.systemRuntime.needsPhaseSummary = false;
  modelState.runtime.systemRuntime.phaseSummaryByCharsPrompted = true;
  modelState.runtime.systemRuntime.phaseSummaryLoopCount = 0;

  const result = await runFunctionCallLoop({
    modelState,
    loopState,
    turn: 1,
  });

  assert.equal(result.output, "final after post-summary overflow");
  assert.equal(toolInvokeCount, 0);
  assert.equal(capturedInvocations.length, 1, "with-tools LLM call should be skipped");
  assert.equal(capturedNoToolInvokeOptions[0]?.tool_choice, "none");
  assert.equal(modelState.runtime.systemRuntime.mainFlowControlInstruction, undefined);
  assert.equal(modelState.runtime.systemRuntime.phaseSummaryByCharsPrompted, true);
});

test("loop over max turns: next turn no-tool response returns directly", async () => {
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
      content: "最终结论",
      tool_calls: [],
      additional_kwargs: {},
      response_metadata: {},
    },
  ]);

  const result = await runFunctionCallLoop({
    modelState: createModelState(llm),
    loopState: createLoopState({ maxTurns: 1, tool }),
    turn: 1,
  });

  assert.equal(toolInvokeCount, 1);
  assert.equal(result.output, "最终结论");
  assert.equal(capturedNoToolInvokeOptions[1]?.tool_choice, "auto");
});
