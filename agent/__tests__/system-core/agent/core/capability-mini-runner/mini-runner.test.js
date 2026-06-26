import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_MINI_RUNNER_TOOL_TURNS,
  createAgentCapabilityModelInvoker,
} from "../../../../../src/system-core/agent/core/capability-mini-runner/index.js";

function createFakeModel(responses = []) {
  let index = 0;
  const invocations = [];
  const model = {
    invocations,
    bindTools() { return this; },
    async invoke(messages, options = {}) {
      invocations.push({ messages, options });
      const response = responses[index] || responses.at(-1) || { content: "" };
      index += 1;
      response.seenMessages = messages;
      response.seenOptions = options;
      return response;
    },
  };
  return model;
}

function createLegacyFakeModel(responses = []) {
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
    enableToolBinding: true,
    createChatModelFn: () => createFakeModel([first, second]),
    adaptToolsForBindingFn: () => ({ tools: [{ name: "echo" }] }),
    executeToolCallFn: async () => ({ toolResultText: "echo:hi" }),
  });

  const result = await invoker({
    messages: [{ role: "user", content: "go" }],
    ctx: { agentContext: { payload: { tools: { registry: [{ name: "echo" }] } } } },
  });

  assert.equal(result.output, "done");
  assert.equal(result.toolTurnLimitReached, false);
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
    enableToolBinding: true,
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
    enableToolBinding: true,
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

test("mini-runner preserves standalone system previous-summary context", async () => {
  let seenMessages = [];
  const invoker = createAgentCapabilityModelInvoker({
    enableToolBinding: false,
    createChatModelFn: () => ({
      async invoke(messages) {
        seenMessages = messages;
        return { content: "ok" };
      },
    }),
  });

  await invoker({
    purpose: "summary",
    messages: [
      { role: "user", content: "继续" },
      { role: "system", content: "<!-- plugin-current-complete-plan-checklist -->\n当前完整计划\n1. A" },
      {
        role: "system",
        content: "<!-- plugin-previous-summary-context -->\n上一次小结\n[SUMMARY_DETAIL]\n- 上一轮完整证据",
      },
      { role: "user", content: "请生成小结" },
    ],
  });

  const checklistIndex = seenMessages.findIndex((item = {}) =>
    String(item?.content || "").includes("plugin-current-complete-plan-checklist"),
  );
  const previousSummaryIndex = seenMessages.findIndex((item = {}) =>
    String(item?.content || "").includes("上一轮完整证据"),
  );
  assert.equal(checklistIndex >= 0, true);
  assert.equal(previousSummaryIndex, checklistIndex + 1);
  assert.equal(seenMessages[previousSummaryIndex]?.role, "system");
});

test("mini-runner treats * as all tools in current registry", async () => {
  const first = {
    content: "need tools",
    tool_calls: [
      { id: "c1", name: "echo", args: {} },
      { id: "c2", name: "other", args: {} },
    ],
  };
  const executed = [];
  const invoker = createAgentCapabilityModelInvoker({
    enableToolBinding: true,
    maxTurns: 1,
    toolAllowlist: ["*"],
    createChatModelFn: () => createFakeModel([first]),
    adaptToolsForBindingFn: (tools) => ({ tools }),
    executeToolCallFn: async ({ call }) => {
      executed.push(call.name);
      return { toolResultText: "ok" };
    },
  });

  const result = await invoker({
    ctx: {
      agentContext: {
        payload: { tools: { registry: [{ name: "echo" }, { name: "other" }] } },
      },
    },
  });

  assert.deepEqual(executed, ["echo", "other"]);
  assert.deepEqual(
    result.traces[0].toolCalls.map((call) => ({ name: call.name, status: call.status })),
    [
      { name: "echo", status: "executed" },
      { name: "other", status: "executed" },
    ],
  );
});

test("mini-runner finalizes with no-tools follow-up when max turns reached without assistant text", async () => {
  const first = {
    content: "",
    tool_calls: [{ id: "c1", name: "echo", args: { text: "hi" } }],
  };
  const second = { content: '{"taskChecklist":[{"index":1,"task":"执行核心任务"}]}' };
  const invoker = createAgentCapabilityModelInvoker({
    enableToolBinding: true,
    maxTurns: 1,
    createChatModelFn: () => createFakeModel([first, second]),
    adaptToolsForBindingFn: () => ({ tools: [{ name: "echo" }] }),
    executeToolCallFn: async () => ({ toolResultText: "echo:hi" }),
  });

  const result = await invoker({
    ctx: { agentContext: { payload: { tools: { registry: [{ name: "echo" }] } } } },
  });

  assert.equal(result.finishedReason, "max_turn_reached_finalized");
  assert.match(String(result.output || ""), /taskChecklist/);
});

test("mini-runner caps tool turns at 5 and returns default planning output when model gives no final text", async () => {
  const makeToolCall = (id) => ({
    content: "",
    tool_calls: [{ id: `c${id}`, name: "echo", args: { text: `hi-${id}` } }],
  });
  const responses = [
    makeToolCall(1),
    makeToolCall(2),
    makeToolCall(3),
    makeToolCall(4),
    makeToolCall(5),
    { content: "" },
  ];
  let executedCount = 0;
  const invoker = createAgentCapabilityModelInvoker({
    enableToolBinding: true,
    maxTurns: 99,
    createChatModelFn: () => createFakeModel(responses),
    adaptToolsForBindingFn: () => ({ tools: [{ name: "echo" }] }),
    executeToolCallFn: async () => {
      executedCount += 1;
      return { toolResultText: "echo:ok" };
    },
  });

  const result = await invoker({
    purpose: "planning",
    locale: "zh-CN",
    ctx: { agentContext: { payload: { tools: { registry: [{ name: "echo" }] } } } },
  });

  assert.equal(executedCount, MAX_MINI_RUNNER_TOOL_TURNS);
  assert.equal(result.turn, MAX_MINI_RUNNER_TOOL_TURNS);
  assert.equal(result.finishedReason, "max_turn_reached_finalized");
  assert.equal(result.toolTurnLimitReached, true);
  assert.equal(result.traces.at(-1)?.toolTurnLimitReached, true);
  assert.match(String(result.output || ""), /taskChecklist/);
  assert.match(String(result.output || ""), /tool_turn_limit_reached/);
});

test("mini-runner uses configured capability model name when provided", async () => {
  let defaultFactoryCalled = false;
  let namedModel = "";
  const invoker = createAgentCapabilityModelInvoker({
    enableToolBinding: true,
    createChatModelFn: () => {
      defaultFactoryCalled = true;
      return createFakeModel([{ content: "default" }]);
    },
    createChatModelByNameFn: (modelName) => {
      namedModel = modelName;
      return createFakeModel([{ content: "named" }]);
    },
  });

  const result = await invoker({
    model: "planner_model_alias",
    purpose: "planning",
    messages: [{ role: "user", content: "go" }],
  });

  assert.equal(defaultFactoryCalled, false);
  assert.equal(namedModel, "planner_model_alias");
  assert.equal(result.output, "named");
  assert.equal(result.traces[0].model, "planner_model_alias");
});

test("mini-runner defaults to no-tool binding invocation", async () => {
  let bindCalled = false;
  const invoker = createAgentCapabilityModelInvoker({
    createChatModelFn: () => ({
      bindTools() {
        bindCalled = true;
        return this;
      },
      async invoke() {
        return { content: "plain result" };
      },
    }),
  });
  const result = await invoker({
    messages: [{ role: "user", content: "go" }],
    ctx: {
      agentContext: {
        payload: {
          tools: { registry: [{ name: "echo" }] },
        },
      },
    },
  });
  assert.equal(bindCalled, false);
  assert.equal(result.finishedReason, "tool_binding_disabled");
  assert.equal(result.output, "plain result");
});

test("mini-runner bound dashscope requests force thinking disabled options", async () => {
  const fakeModel = createFakeModel([{ content: "ok" }]);
  const invoker = createAgentCapabilityModelInvoker({
    enableToolBinding: true,
    createChatModelFn: () => fakeModel,
    resolveDefaultModelSpecFn: () => ({ format: "dashscope", preserve_thinking: true, thinking_budget: 2048 }),
    adaptToolsForBindingFn: () => ({ tools: [{ name: "echo" }] }),
  });

  await invoker({
    ctx: { agentContext: { payload: { tools: { registry: [{ name: "echo" }] } } } },
  });

  assert.equal(fakeModel.invocations[0].options.preserve_thinking, false);
  assert.equal(fakeModel.invocations[0].options.thinking_budget, 0);
});

test("mini-runner bound openai compatible requests force reasoning_effort low", async () => {
  const fakeModel = createFakeModel([{ content: "ok" }]);
  const invoker = createAgentCapabilityModelInvoker({
    enableToolBinding: true,
    createChatModelByNameFn: () => fakeModel,
    resolveModelSpecByNameFn: ({ modelName }) => ({ model: modelName, format: "openai_compatible", reasoning_effort: "high" }),
    adaptToolsForBindingFn: () => ({ tools: [{ name: "echo" }] }),
  });

  await invoker({
    model: "named-openai",
    ctx: { agentContext: { payload: { tools: { registry: [{ name: "echo" }] } } } },
  });

  assert.equal(fakeModel.invocations[0].options.reasoning_effort, "low");
});

test("mini-runner does not inject bound-tool overrides without bound tools", async () => {
  const fakeModel = createFakeModel([{ content: "ok" }]);
  const invoker = createAgentCapabilityModelInvoker({
    enableToolBinding: true,
    createChatModelFn: () => fakeModel,
    resolveDefaultModelSpecFn: () => ({ format: "dashscope" }),
    adaptToolsForBindingFn: () => ({ tools: [] }),
  });

  await invoker({
    ctx: { agentContext: { payload: { tools: { registry: [{ name: "echo" }] } } } },
  });

  assert.equal("preserve_thinking" in fakeModel.invocations[0].options, false);
  assert.equal("thinking_budget" in fakeModel.invocations[0].options, false);
  assert.equal("reasoning_effort" in fakeModel.invocations[0].options, false);
});

test("mini-runner filters only summarized history before first model invoke", async () => {
  let firstInvokeMessages = [];
  const invoker = createAgentCapabilityModelInvoker({
    enableToolBinding: true,
    createChatModelFn: () => ({
      bindTools() {
        return this;
      },
      async invoke(messages) {
        if (!firstInvokeMessages.length) firstInvokeMessages = messages.map((item) => ({ ...item }));
        return { content: "ok" };
      },
    }),
    adaptToolsForBindingFn: () => ({ tools: [{ name: "echo" }] }),
  });

  await invoker({
    messages: [
      { role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "echo" } }] },
      { role: "tool", content: "{\"ok\":true}", tool_call_id: "c1" },
      { role: "assistant", content: "keep-assistant" },
      { role: "user", content: "keep-user" },
      { role: "assistant", content: "drop-summarized", summarized: true },
    ],
    ctx: { agentContext: { payload: { tools: { registry: [{ name: "echo" }] } } } },
  });

  assert.deepEqual(
    firstInvokeMessages.map((item) => ({ role: item.role, content: item.content })),
    [
      { role: "assistant", content: "" },
      { role: "tool", content: "{\"ok\":true}" },
      { role: "assistant", content: "keep-assistant" },
      { role: "user", content: "keep-user" },
    ],
  );
});

test("mini-runner compacts semantic-transfer tool messages before model invoke", async () => {
  let firstInvokeMessages = [];
  const invoker = createAgentCapabilityModelInvoker({
    enableToolBinding: true,
    createChatModelFn: () => ({
      bindTools() {
        return this;
      },
      async invoke(messages) {
        if (!firstInvokeMessages.length) firstInvokeMessages = messages.map((item) => ({ ...item }));
        return { content: "ok" };
      },
    }),
    adaptToolsForBindingFn: () => ({ tools: [{ name: "echo" }] }),
  });
  const attachmentMeta = {
    attachmentId: "att-mini",
    name: "result.md",
    mimeType: "text/markdown",
    size: 12,
    relativePath: "runtime/attach/scoped/s1/model/result.md",
  };
  const envelope = {
    protocol: "noobot.semantic-transfer",
    version: 1,
    direction: "output",
    transport: "file",
    filePath: "/workspace/result.md",
    files: [{ filePath: "/workspace/result.md", attachmentMeta }],
  };

  await invoker({
    messages: [
      { role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "echo" } }] },
      {
        role: "tool",
        content: JSON.stringify({
          ok: true,
          transferEnvelopes: [envelope],
          attachmentMetas: [attachmentMeta],
        }),
        tool_call_id: "c1",
      },
    ],
    ctx: { agentContext: { payload: { tools: { registry: [{ name: "echo" }] } } } },
  });

  const compactedToolPayload = JSON.parse(firstInvokeMessages.find((item) => item.role === "tool").content);
  assert.equal("transferEnvelopes" in compactedToolPayload, false);
  assert.equal("attachmentMetas" in compactedToolPayload, false);
  assert.equal(compactedToolPayload.transferFiles[0].attachmentId, "att-mini");
});
