/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_MINI_RUNNER_TOOL_TURNS,
  createAgentCapabilityModelInvoker,
} from "../../../../src/runtime/capability-runner/index.js";
import { createTestAgentExecutionScope } from "../../../helpers/agent-execution-scope.js";

const modelSpec = Object.freeze({
  alias: "test",
  model: "test-model",
  format: "openai_compatible",
  providerId: "test",
  adapterId: "openai-compatible",
});

function createModelPort(outputs = []) {
  let index = 0;
  const requests = [];
  return {
    requests,
    async invoke(request) {
      requests.push(request);
      const output = outputs[index] || outputs.at(-1) || { text: "" };
      index += 1;
      return {
        output: {
          text: String(output.text || ""),
          reasoning: String(output.reasoning || ""),
          toolCalls: Array.isArray(output.toolCalls) ? output.toolCalls : [],
          finishReason: String(output.finishReason || ""),
          usage: output.usage || {},
        },
        execution: { attemptCount: 1, attempts: [], model: modelSpec, provider: {} },
      };
    },
  };
}

function createContext({ modelPort, tools = [], eventListener = null } = {}) {
  const runtime = {
    globalConfig: {},
    userConfig: {},
    modelPort,
    eventListener,
    systemRuntime: { turnScopeId: "turn-test" },
  };
  return {
    runtime,
    ctx: {
      sessionId: "session-test",
      dialogProcessId: "dialog-test",
      agentContext: createTestAgentExecutionScope(runtime, { tools }),
    },
  };
}

function createInvoker(options = {}) {
  return createAgentCapabilityModelInvoker({
    resolveDefaultModelSpecFn: () => modelSpec,
    resolveModelSpecByNameFn: () => modelSpec,
    ...options,
  });
}

test("mini-runner sends canonical requests through the host ModelPort", async () => {
  const modelPort = createModelPort([{ text: "done" }]);
  const { ctx } = createContext({ modelPort });
  const result = await createInvoker({ enableToolBinding: false })({
    purpose: "planning",
    domain: "workflow",
    messages: [{ role: "user", content: "plan" }],
    ctx,
  });

  assert.equal(result.output.text, "done");
  assert.equal(result.finishedReason, "tool_binding_disabled");
  assert.equal(modelPort.requests.length, 1);
  assert.equal(modelPort.requests[0].invocation.purpose, "planning");
  assert.equal(modelPort.requests[0].invocation.domain, "workflow");
  assert.equal(modelPort.requests[0].options.streaming, false);
});

test("mini-runner appends assistant tool calls and tool results before the next request", async () => {
  const modelPort = createModelPort([
    { text: "need tool", toolCalls: [{ id: "c1", name: "echo", args: { text: "hi" } }] },
    { text: "done" },
  ]);
  const tool = { name: "echo" };
  const { ctx } = createContext({ modelPort, tools: [tool] });
  const executed = [];
  const result = await createInvoker({
    enableToolBinding: true,
    toolAllowlist: ["echo"],
    adaptToolsForBindingFn: () => ({ tools: [tool], bindOptions: { tool_choice: "auto" } }),
    executeToolCallFn: async ({ call }) => {
      executed.push(call);
      return { toolResultText: "echo:hi" };
    },
  })({ messages: [{ role: "user", content: "go" }], ctx });

  assert.equal(result.output.text, "done");
  assert.equal(result.finishedReason, "no_tool_call");
  assert.equal(executed[0].name, "echo");
  assert.deepEqual(executed[0].args, { text: "hi" });
  const secondMessages = modelPort.requests[1].messages;
  assert.equal(secondMessages[1].role, "assistant");
  assert.equal(secondMessages[1].tool_calls[0].id, "c1");
  assert.equal(secondMessages[2].role, "tool");
  assert.equal(secondMessages[2].content, "echo:hi");
  assert.deepEqual(modelPort.requests[0].options.toolBinding, { tool_choice: "auto" });
});

test("mini-runner records rejected and missing tools without invoking them", async () => {
  const modelPort = createModelPort([
    {
      text: "",
      toolCalls: [
        { id: "blocked", name: "blocked", args: {} },
        { id: "missing", name: "missing", args: {} },
      ],
    },
  ]);
  const { ctx } = createContext({ modelPort, tools: [{ name: "missing" }] });
  let executions = 0;
  const result = await createInvoker({
    enableToolBinding: true,
    maxTurns: 1,
    toolAllowlist: ["missing"],
    adaptToolsForBindingFn: () => ({ tools: [] }),
    executeToolCallFn: async () => {
      executions += 1;
      return { toolResultText: "unexpected" };
    },
  })({ ctx });

  assert.equal(executions, 0);
  assert.deepEqual(
    result.toolTurns[0].toolCalls.map(({ name, status }) => ({ name, status })),
    [
      { name: "blocked", status: "rejected" },
      { name: "missing", status: "not_found" },
    ],
  );
});

test("mini-runner isolates explicit model selection and plugin headers", async () => {
  const modelPort = createModelPort([{ text: "selected" }]);
  const { ctx } = createContext({ modelPort });
  let resolvedName = "";
  const invoker = createAgentCapabilityModelInvoker({
    enableToolBinding: false,
    resolveDefaultModelSpecFn: () => {
      throw new Error("default model must not be selected");
    },
    resolveModelSpecByNameFn: ({ modelName }) => {
      resolvedName = modelName;
      return modelSpec;
    },
  });

  await invoker({
    model: "planning-model",
    purpose: "planning",
    domain: "workflow",
    pluginFlow: "plan",
    messages: [],
    ctx,
  });

  assert.equal(resolvedName, "planning-model");
  assert.equal(modelPort.requests[0].options.headers["X-Plugin-Flow"], "plugin.plan");
  assert.equal(modelPort.requests[0].options.headers["X-Plugin-Purpose"], "planning");
  assert.equal(modelPort.requests[0].options.headers["X-Plugin-Domain"], "workflow");
});

test("mini-runner requires the authoritative host ModelPort", async () => {
  const { ctx } = createContext({ modelPort: null });
  await assert.rejects(
    createInvoker({ enableToolBinding: false })({ messages: [], ctx }),
    /requires the host ModelPort/,
  );
});

test("mini-runner enforces the configured tool-turn limit and finalizes through ModelPort", async () => {
  const toolCall = { text: "", toolCalls: [{ id: "c1", name: "echo", args: {} }] };
  const modelPort = createModelPort([
    ...Array.from({ length: MAX_MINI_RUNNER_TOOL_TURNS }, () => toolCall),
    { text: "finalized" },
  ]);
  const tool = { name: "echo" };
  const { ctx } = createContext({ modelPort, tools: [tool] });
  const result = await createInvoker({
    enableToolBinding: true,
    toolAllowlist: ["echo"],
    adaptToolsForBindingFn: () => ({ tools: [tool] }),
    executeToolCallFn: async () => ({ toolResultText: "ok" }),
  })({ messages: [], ctx });

  assert.equal(result.toolTurnLimitReached, true);
  assert.equal(result.output.text, "finalized");
  assert.equal(modelPort.requests.length, MAX_MINI_RUNNER_TOOL_TURNS + 1);
});
