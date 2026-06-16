import test from "node:test";
import assert from "node:assert/strict";
import { HumanMessage } from "@langchain/core/messages";

import { runFunctionCallLoop } from "../../../../src/system-core/agent/core/turn/orchestrator.js";
import { createAgentHookManager } from "../../../../src/system-core/hook/index.js";

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
    activeModelName: "test-model",
    activeModelAlias: "test_alias",
    eventListener: null,
    runtime: {
      systemRuntime: {
        config: { forceTool: true },
      },
    },
    globalConfig: {},
    userConfig: {},
    defaultModelSpec: resolvedModelSpec,
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

  const result = await runFunctionCallLoop({
    modelState: createModelState(llm),
    loopState: createLoopState({ maxTurns: 1, tool }),
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
});

test("when model returns no tool calls, add a user prompt to use tools and retry", async () => {
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
  const result = await runFunctionCallLoop({
    modelState,
    loopState: createLoopState({ maxTurns: 3, tool }),
    turn: 1,
  });

  assert.equal(result.output, "还是直接回答");
  assert.equal(capturedInvocations.length, 2);
  assert.equal(capturedNoToolInvokeOptions[0]?.tool_choice, "auto");
  assert.equal(capturedNoToolInvokeOptions[1]?.tool_choice, "auto");
  assert.ok(
    events.some((item) => item?.event === "tool_choice_required_retry_prompted"),
    "should emit retry prompt event when model does not call tools",
  );
});

test("when forceTool is disabled, no-tool response should return directly without retry prompt", async () => {
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
  modelState.runtime.systemRuntime.config = { forceTool: false };
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

test("retry prompt should only happen once; next no-tool response ends by original logic", async () => {
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

  assert.equal(result.output, "第二次无工具");
  assert.equal(capturedInvocations.length, 2);
  const secondInvocationMessages = capturedInvocations[1] || [];
  const retryPromptsInSecondInvocation = secondInvocationMessages.filter((messageItem) => {
    const marker =
      messageItem?.additional_kwargs?.noobotInternalMessageType ||
      messageItem?.lc_kwargs?.additional_kwargs?.noobotInternalMessageType ||
      "";
    return marker === "tool_choice_required_retry_prompt";
  });
  assert.equal(
    retryPromptsInSecondInvocation.length,
    1,
    "should append exactly one retry prompt before the final retry",
  );
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

test("auto tool_choice should not force non-thinking params", async () => {
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
    modelState: createModelState(llm),
    loopState: createLoopState({ maxTurns: 1, tool }),
    turn: 1,
  });

  assert.equal(toolInvokeCount, 1);
  assert.equal(capturedNoToolInvokeOptions[0]?.tool_choice, "auto");
  assert.equal(capturedNoToolInvokeOptions[1]?.tool_choice, "auto");
  assert.equal(capturedNoToolInvokeOptions[1]?.enable_thinking, undefined);
  assert.equal(capturedNoToolInvokeOptions[1]?.preserve_thinking, undefined);
  assert.equal(capturedNoToolInvokeOptions[1]?.thinking_budget, undefined);
  assert.equal(result.output, "收尾结果");
});

test("multiple tool calls are replayed as one assistant/tool pair per loop without extra LLM calls", async () => {
  const invokedArgs = [];
  const tool = {
    name: "execute_script",
    async invoke(args = {}) {
      invokedArgs.push(args);
      return JSON.stringify({ ok: true, value: args.value });
    },
  };
  const { llm, capturedInvocations } = createToolCallingLlm([
    {
      content: "检查多个文件",
      tool_calls: [
        { id: "call_1", name: "execute_script", args: { value: 1 } },
        { id: "call_2", name: "execute_script", args: { value: 2 } },
        { id: "call_3", name: "execute_script", args: { value: 3 } },
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
  modelState.runtime.systemRuntime.config = { forceTool: false };
  const result = await runFunctionCallLoop({
    modelState,
    loopState,
    turn: 1,
  });

  assert.equal(result.output, "完成");
  assert.deepEqual(invokedArgs, [{ value: 1 }, { value: 2 }, { value: 3 }]);
  assert.equal(capturedInvocations.length, 2, "synthetic tool turns should not call the LLM");

  const toolCallMessages = loopState.turnMessages.filter((item) => item.role === "assistant");
  const toolResultMessages = loopState.turnMessages.filter((item) => item.role === "tool");
  const userPromptMessages = loopState.turnMessages.filter((item) => item.role === "user");
  assert.equal(toolResultMessages.length, 3);
  assert.deepEqual(
    toolCallMessages.slice(0, 3).map((item) => item.tool_calls.map((call) => call.id)),
    [["call_1"], ["call_2"], ["call_3"]],
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
  const toolBatchLimitPromptMessage = [...secondInvocationMessages]
    .reverse()
    .find((messageItem) =>
      messageItem instanceof HumanMessage &&
      /不要一次返回 3 条及以上工具|do not return 3 or more at once/i.test(
        String(messageItem?.content || ""),
      ));
  assert.ok(
    toolBatchLimitPromptMessage,
    "should inject a user prompt when a split synthetic batch has 3+ tool calls",
  );
  assert.equal(
    toolBatchLimitPromptMessage.additional_kwargs?.noobotInternalMessageType,
    undefined,
    "tool-batch-limit prompt must remain visible to plugin before_llm_call cleanup",
  );
  assert.equal(
    toolBatchLimitPromptMessage.additional_kwargs?.noobotModelOnlyMessage,
    true,
    "tool-batch-limit prompt should be explicitly marked as model-context-only",
  );
  assert.equal(
    toolBatchLimitPromptMessage.additional_kwargs?.noobotModelOnlyMessageReason,
    "tool_batch_limit_prompt",
  );
  const assistantToolCallCounts = secondInvocationMessages
    .filter((message) => String(message?._getType?.() || "") === "ai")
    .map((message) => (Array.isArray(message.tool_calls) ? message.tool_calls.length : 0));
  assert.ok(
    assistantToolCallCounts.slice(-3).every((count) => count === 1),
    "each assistant message sent to the next LLM call should contain one tool call",
  );

  const syntheticBeforeLlm = beforeLlmContexts.filter((ctx) => ctx?.fakeTurn === true);
  const syntheticAfterLlm = afterLlmContexts.filter((ctx) => ctx?.fakeTurn === true);
  const syntheticBeforeToolCalls = beforeToolCallContexts.filter((ctx) => ctx?.fakeTurn === true);
  const syntheticAfterToolCalls = afterToolCallContexts.filter((ctx) => ctx?.fakeTurn === true);
  assert.equal(syntheticBeforeLlm.length, 2);
  assert.equal(syntheticAfterLlm.length, 2);
  assert.equal(syntheticBeforeToolCalls.length, 2);
  assert.equal(syntheticAfterToolCalls.length, 2);
  assert.deepEqual(
    syntheticBeforeLlm.map((ctx) => ctx.calls?.[0]?.id),
    ["call_2", "call_3"],
  );
  assert.ok(
    syntheticBeforeLlm.every(
      (ctx) => ctx.synthetic === true &&
        ctx.replayedToolTurn === true &&
        ctx.mode === "synthetic_tool_turn" &&
        ctx.source === "split_multi_tool_calls",
    ),
  );
});
