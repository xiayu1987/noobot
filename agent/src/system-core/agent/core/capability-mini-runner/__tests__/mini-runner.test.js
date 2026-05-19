import test from "node:test";
import assert from "node:assert/strict";

import { createAgentCapabilityModelInvoker } from "../index.js";

function createFakeModel(responses = []) {
  let index = 0;
  return {
    bindTools() { return this; },
    async invoke(messages) {
      const response = responses[index] || responses.at(-1) || { content: "" };
      index += 1;
      response.seenMessages = messages;
      return response;
    },
  };
}

test("mini-runner appends assistant tool-call message before tool result", async () => {
  const first = {
    content: "need tool",
    tool_calls: [{ id: "c1", name: "echo", args: { text: "hi" } }],
  };
  const second = { content: "done" };
  const invoker = createAgentCapabilityModelInvoker({
    createChatModelFn: () => createFakeModel([first, second]),
    adaptToolsForBindingFn: () => ({ tools: [{ name: "echo" }] }),
    executeToolCallFn: async () => ({ toolResultText: "echo:hi" }),
  });

  const result = await invoker({
    messages: [{ role: "user", content: "go" }],
    ctx: { agentContext: { payload: { tools: { registry: [{ name: "echo" }] } } } },
  });

  assert.equal(result.output, "done");
  assert.equal(second.seenMessages.at(1), first);
  assert.equal(second.seenMessages.at(2).role, "tool");
});

test("mini-runner supports OpenAI function-style tool calls and JSON args", async () => {
  const first = {
    content: "",
    additional_kwargs: {
      tool_calls: [{ id: "c2", function: { name: "echo", arguments: '{"text":"hi"}' } }],
    },
  };
  let capturedCall = null;
  const invoker = createAgentCapabilityModelInvoker({
    maxTurns: 1,
    createChatModelFn: () => createFakeModel([first]),
    adaptToolsForBindingFn: () => ({ tools: [{ name: "echo" }] }),
    executeToolCallFn: async ({ call }) => { capturedCall = call; return { toolResultText: "ok" }; },
  });

  await invoker({ ctx: { agentContext: { payload: { tools: { registry: [{ name: "echo" }] } } } } });
  assert.equal(capturedCall.name, "echo");
  assert.deepEqual(capturedCall.args, { text: "hi" });
});

test("mini-runner records rejected and missing tool call statuses in traces", async () => {
  const first = {
    content: "need tools",
    tool_calls: [
      { id: "c1", name: "blocked", args: {} },
      { id: "c2", name: "missing", args: {} },
    ],
  };
  const invoker = createAgentCapabilityModelInvoker({
    maxTurns: 1,
    toolAllowlist: ["missing"],
    createChatModelFn: () => createFakeModel([first]),
    adaptToolsForBindingFn: () => ({ tools: [] }),
    executeToolCallFn: async () => ({ toolResultText: "should-not-run" }),
  });

  const result = await invoker({
    ctx: { agentContext: { payload: { tools: { registry: [{ name: "missing" }] } } } },
  });

  assert.deepEqual(
    result.traces[0].toolCalls.map((call) => ({ name: call.name, status: call.status })),
    [
      { name: "blocked", status: "rejected" },
      { name: "missing", status: "not_found" },
    ],
  );
});
