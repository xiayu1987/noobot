import test from "node:test";
import assert from "node:assert/strict";
import { HumanMessage } from "@langchain/core/messages";

import { runFunctionCallLoop } from "../../../../system-core/agent/core/turn/orchestrator.js";

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

function createModelState(llm) {
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
    defaultModelSpec: { alias: "test_alias", model: "test-model" },
    abortSignal: null,
  };
}

test("loop over max turns: inject finalize prompt once and stop if next turn still asks tools", async () => {
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
  ]);

  const result = await runFunctionCallLoop({
    modelState: createModelState(llm),
    loopState: createLoopState({ maxTurns: 1, tool }),
    turn: 1,
  });

  assert.equal(toolInvokeCount, 1, "grace turn should not execute tools again");
  assert.match(result.output, /上限|limit/i);
  assert.equal(capturedInvocations.length, 2);
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
    loopState: createLoopState({ maxTurns: 1, tool }),
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

test("loop over max turns: next turn no-tool response will keep retrying and finally stop at limit", async () => {
  let toolInvokeCount = 0;
  const tool = {
    name: "execute_script",
    async invoke() {
      toolInvokeCount += 1;
      return "{\"ok\":true}";
    },
  };
  const { llm } = createToolCallingLlm([
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
  assert.match(result.output, /上限|limit/i);
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
  assert.equal(capturedNoToolInvokeOptions[0]?.enable_thinking, undefined);
  assert.equal(capturedNoToolInvokeOptions[0]?.preserve_thinking, undefined);
  assert.equal(capturedNoToolInvokeOptions[0]?.thinking_budget, undefined);
  assert.match(result.output, /上限|limit/i);
});
