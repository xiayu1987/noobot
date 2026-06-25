import test from "node:test";
import assert from "node:assert/strict";

import {
  invokeNoToolsTurn,
  invokeWithToolsTurn,
} from "../../../../src/system-core/agent/core/turn/turn-executor.js";

test("invokeNoToolsTurn filters only summarized messages before llm invoke", async () => {
  let capturedMessages = [];
  const llm = {
    async invoke(messages) {
      capturedMessages = (Array.isArray(messages) ? messages : []).map((item) => ({ ...item }));
      return { content: "ok" };
    },
  };

  const modelState = {
    llm,
    runtime: { systemRuntime: {} },
    eventListener: null,
    abortSignal: null,
    defaultModelSpec: {},
  };
  const loopState = {
    messages: [
      { role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "execute_script" } }] },
      { role: "tool", content: "{\"ok\":true}", tool_call_id: "c1" },
      { role: "assistant", content: "summarized", summarized: true },
      { role: "user", content: "keep-user" },
    ],
    messageBlocks: {
      system: [],
      history: [],
      incremental: [
        { role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "execute_script" } }] },
        { role: "tool", content: "{\"ok\":true}", tool_call_id: "c1" },
        { role: "assistant", content: "summarized", summarized: true },
        { role: "user", content: "keep-user" },
      ],
    },
    traces: [],
    turnMessages: [],
    turnTasks: [],
    currentTurnMessages: null,
    currentTurnTasks: null,
    dialogProcessId: "d1",
    maxTurns: 1,
  };

  const result = await invokeNoToolsTurn({ modelState, loopState, turn: 1 });

  assert.deepEqual(
    capturedMessages.map((item) => ({ role: item.role, content: item.content })),
    [
      { role: "assistant", content: "" },
      { role: "tool", content: "{\"ok\":true}" },
      { role: "user", content: "keep-user" },
    ],
  );
  assert.equal(result.output, "ok");
  const finalResponse = loopState.messages.at(-1);
  assert.equal(finalResponse.content, "ok");
  assert.equal(loopState.messageBlocks.incremental.at(-1), finalResponse);
  assert.ok(loopState.messageBlocks.incrementalIds.includes(
    finalResponse.additional_kwargs.noobotMessageId,
  ));
});

test("invokeWithToolsTurn filters only summarized messages before llm invoke", async () => {
  let capturedMessages = [];
  const llm = {
    bindTools() {
      return {
        async invoke(messages) {
          capturedMessages = (Array.isArray(messages) ? messages : []).map((item) => ({ ...item }));
          return { content: "ok-with-tools", tool_calls: [], additional_kwargs: {}, response_metadata: {} };
        },
      };
    },
  };

  const modelState = {
    llm,
    runtime: { systemRuntime: {} },
    eventListener: null,
    abortSignal: null,
    defaultModelSpec: {},
  };
  const loopState = {
    messages: [
      { role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "execute_script" } }] },
      { role: "tool", content: "{\"ok\":true}", tool_call_id: "c1" },
      { role: "assistant", content: "keep-assistant" },
      { role: "user", content: "keep-user" },
      { role: "assistant", content: "drop-summarized", summarized: true },
    ],
    messageBlocks: {
      system: [],
      history: [],
      incremental: [
        { role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "execute_script" } }] },
        { role: "tool", content: "{\"ok\":true}", tool_call_id: "c1" },
        { role: "assistant", content: "keep-assistant" },
        { role: "user", content: "keep-user" },
        { role: "assistant", content: "drop-summarized", summarized: true },
      ],
    },
    traces: [],
    tools: [{ name: "execute_script" }],
    turnMessages: [],
    turnTasks: [],
    currentTurnMessages: null,
    currentTurnTasks: null,
    dialogProcessId: "d2",
    maxTurns: 1,
  };

  const result = await invokeWithToolsTurn({ modelState, loopState, turn: 1 });
  assert.equal(result.aiContentText, "ok-with-tools");
  assert.deepEqual(
    capturedMessages.map((item) => ({ role: item.role, content: item.content })),
    [
      { role: "assistant", content: "" },
      { role: "tool", content: "{\"ok\":true}" },
      { role: "assistant", content: "keep-assistant" },
      { role: "user", content: "keep-user" },
    ],
  );
  const finalAssistant = loopState.messages.at(-1);
  assert.equal(finalAssistant.content, "ok-with-tools");
  assert.equal(loopState.messageBlocks.incremental.at(-1), finalAssistant);
  assert.ok(loopState.messageBlocks.incrementalIds.includes(
    finalAssistant.additional_kwargs.noobotMessageId,
  ));
});

test("invokeWithToolsTurn stores assistant tool-call message in incremental block", async () => {
  const llm = {
    bindTools() {
      return {
        async invoke() {
          return {
            content: "",
            tool_calls: [{ id: "call_1", name: "execute_script", args: {} }],
            additional_kwargs: {},
            response_metadata: {},
          };
        },
      };
    },
  };

  const modelState = {
    llm,
    runtime: { systemRuntime: {} },
    eventListener: null,
    abortSignal: null,
    defaultModelSpec: {},
  };
  const loopState = {
    messages: [{ role: "user", content: "run tool" }],
    messageBlocks: { system: [], history: [], incremental: [{ role: "user", content: "run tool" }] },
    traces: [],
    tools: [{ name: "execute_script" }],
    turnMessages: [],
    turnTasks: [],
    currentTurnMessages: null,
    currentTurnTasks: null,
    dialogProcessId: "d-tool-call",
    maxTurns: 1,
  };

  const result = await invokeWithToolsTurn({ modelState, loopState, turn: 1 });

  assert.equal(result.calls.length, 1);
  const assistantToolCall = loopState.messages.at(-1);
  assert.equal(Array.isArray(assistantToolCall.tool_calls), true);
  assert.equal(loopState.messageBlocks.incremental.at(-1), assistantToolCall);
  assert.ok(loopState.messageBlocks.incrementalIds.includes(
    assistantToolCall.additional_kwargs.noobotMessageId,
  ));
});

test("invokeWithToolsTurn does not final-stream when runConfig disables streaming", async () => {
  const events = [];
  const llm = {
    bindTools() {
      return {
        async invoke() {
          return {
            content: "ok-without-final-stream",
            tool_calls: [],
            additional_kwargs: {},
            response_metadata: {},
          };
        },
      };
    },
  };

  const modelState = {
    llm,
    runtime: {
      runConfig: { streaming: false },
      systemRuntime: {},
    },
    globalConfig: { streaming: true },
    userConfig: {},
    eventListener: {
      onEvent(payload = {}) {
        events.push(payload);
      },
    },
    abortSignal: null,
    defaultModelSpec: {},
  };
  const loopState = {
    messages: [{ role: "user", content: "keep-user" }],
    traces: [],
    tools: [{ name: "execute_script" }],
    turnMessages: [],
    turnTasks: [],
    currentTurnMessages: null,
    currentTurnTasks: null,
    dialogProcessId: "d-stream-disabled",
    maxTurns: 1,
  };

  const result = await invokeWithToolsTurn({ modelState, loopState, turn: 1 });

  assert.equal(result.aiContentText, "ok-without-final-stream");
  assert.equal(result.finalStreaming, null);
  assert.equal(
    events.some((item) => String(item?.event || "") === "llm_final_stream_start"),
    false,
  );
});

test("invokeNoToolsTurn stores reasoning-only retry prompt in incremental block", async () => {
  let callCount = 0;
  const llm = {
    async invoke() {
      callCount += 1;
      if (callCount === 1) {
        return { content: "", additional_kwargs: { reasoning_content: "thinking only" } };
      }
      return { content: "ok after retry" };
    },
  };

  const modelState = {
    llm,
    runtime: { systemRuntime: {} },
    eventListener: null,
    abortSignal: null,
    defaultModelSpec: {},
  };
  const loopState = {
    messages: [{ role: "user", content: "go" }],
    messageBlocks: { system: [], history: [], incremental: [{ role: "user", content: "go" }] },
    traces: [],
    turnMessages: [],
    turnTasks: [],
    currentTurnMessages: null,
    currentTurnTasks: null,
    dialogProcessId: "d-reasoning-no-tools",
    maxTurns: 1,
  };

  const result = await invokeNoToolsTurn({ modelState, loopState, turn: 1 });

  assert.equal(result.output, "ok after retry");
  const retryPrompt = loopState.messageBlocks.incremental.find((message) =>
    String(message?.content || "").includes("thinking only"),
  );
  assert.ok(retryPrompt);
  assert.ok(loopState.messageBlocks.incrementalIds.includes(
    retryPrompt.additional_kwargs.noobotMessageId,
  ));
});

test("invokeWithToolsTurn stores reasoning-only retry prompt in incremental block", async () => {
  let callCount = 0;
  const llm = {
    bindTools() {
      return {
        async invoke() {
          callCount += 1;
          if (callCount === 1) {
            return { content: "", additional_kwargs: { reasoning_content: "thinking with tools" } };
          }
          return {
            content: "ok with tools after retry",
            tool_calls: [],
            additional_kwargs: {},
            response_metadata: {},
          };
        },
      };
    },
  };

  const modelState = {
    llm,
    runtime: {
      runConfig: { streaming: false },
      systemRuntime: {},
    },
    globalConfig: { streaming: true },
    userConfig: {},
    eventListener: null,
    abortSignal: null,
    defaultModelSpec: {},
  };
  const loopState = {
    messages: [{ role: "user", content: "go" }],
    messageBlocks: { system: [], history: [], incremental: [{ role: "user", content: "go" }] },
    traces: [],
    tools: [{ name: "execute_script" }],
    turnMessages: [],
    turnTasks: [],
    currentTurnMessages: null,
    currentTurnTasks: null,
    dialogProcessId: "d-reasoning-tools",
    maxTurns: 1,
  };

  const result = await invokeWithToolsTurn({ modelState, loopState, turn: 1 });

  assert.equal(result.aiContentText, "ok with tools after retry");
  const retryPrompt = loopState.messageBlocks.incremental.find((message) =>
    String(message?.content || "").includes("thinking with tools"),
  );
  assert.ok(retryPrompt);
  assert.ok(loopState.messageBlocks.incrementalIds.includes(
    retryPrompt.additional_kwargs.noobotMessageId,
  ));
});
