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
    traces: [],
    turnMessages: [],
    turnTasks: [],
    currentTurnMessages: null,
    currentTurnTasks: null,
    dialogProcessId: "d1",
    maxTurns: 1,
  };

  await invokeNoToolsTurn({ modelState, loopState, turn: 1 });

  assert.deepEqual(
    capturedMessages.map((item) => ({ role: item.role, content: item.content })),
    [
      { role: "assistant", content: "" },
      { role: "tool", content: "{\"ok\":true}" },
      { role: "user", content: "keep-user" },
    ],
  );
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
});
