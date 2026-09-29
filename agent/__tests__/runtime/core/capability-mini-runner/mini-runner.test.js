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
import {
  createModelResponse,
  MODEL_CONTEXT_SEQUENCE_POLICY,
  validateModelResponse,
} from "@noobot/model-protocol";
import { bindAssistantMessageEventStream } from "../../../../src/events/message-event-stream.js";
import { createCanonicalMessageEventSessionManager } from "../../../helpers/canonical-message-event-session-manager.js";
import { createConfigSnapshot } from "@noobot/agent-config-protocol";
import { reduceCanonicalActivityTimeline } from "@noobot/event-protocol/activity-timeline";

const modelSpec = Object.freeze({
  alias: "test",
  model: "test-model",
  reasoning_effort_parameter: "reasoning_effort",
  reasoning_effort_options: ["none", "low", "medium", "high"],
  providerId: "test",
  adapterId: "openai-compatible",
});

function createModelPort(outputs = []) {
  let index = 0;
  let responseSequence = 0;
  const requests = [];
  return {
    requests,
    async invoke(request) {
      requests.push(request);
      const output = outputs[index] || outputs.at(-1) || { text: "" };
      for (const token of output.tokens || []) {
        for (const callback of request.options.callbacks || [])
          await callback.handleLLMNewToken(token);
      }
      for (const callback of request.options.callbacks || []) await callback.handleLLMEnd();
      index += 1;
      responseSequence += 1;
      const canonicalOutput = {
        text: String(output.text || ""),
        reasoning: String(output.reasoning || ""),
        toolCalls: Array.isArray(output.toolCalls) ? output.toolCalls : [],
        finishReason: String(output.finishReason || ""),
        usage: output.usage || {},
      };
      return createModelResponse({
        invocation: {
          requestId: `request-${responseSequence}`,
          invocationId: `invocation-${responseSequence}`,
          sessionId: "session-test",
          parentSessionId: "",
          dialogProcessId: "dialog-test",
          turnScopeId: "turn-test",
          runId: "agent:turn-test",
          flow: request.invocation.flow,
          purpose: request.invocation.purpose,
          domain: request.invocation.domain,
          contextSequencePolicy:
            request.invocation.contextSequencePolicy ||
            MODEL_CONTEXT_SEQUENCE_POLICY.INDEPENDENT_REQUEST,
        },
        output: canonicalOutput,
        attempts: [
          {
            attempt: 1,
            status: "completed",
            kind: "response",
            streaming: false,
            output: canonicalOutput,
          },
        ],
        model: modelSpec,
        provider: { operatorId: modelSpec.providerId, adapterId: modelSpec.adapterId },
      });
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
    configSnapshot: createConfigSnapshot(),
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
  assert.equal(validateModelResponse(result), result);
  assert.equal(modelPort.requests.length, 1);
  assert.equal(modelPort.requests[0].invocation.purpose, "planning");
  assert.equal(modelPort.requests[0].invocation.domain, "workflow");
  assert.equal(modelPort.requests[0].options.streaming, false);
});

test("guidance analysis publishes only the canonical Message Event content field", async () => {
  const modelPort = createModelPort([{ text: "guidance result" }]);
  const committedEvents = [];
  const { ctx, runtime } = createContext({
    modelPort,
    eventListener: {
      onEvent(event) {
        committedEvents.push(event);
      },
    },
  });
  runtime.userId = "test-user";
  runtime.sessionManager = createCanonicalMessageEventSessionManager();
  runtime.systemRuntime.sessionId = "session-test";
  runtime.systemRuntime.dialogProcessId = "dialog-test";
  bindAssistantMessageEventStream(runtime, {
    messageId: "message-test",
    presentationMessageId: "presentation-test",
  });

  await createInvoker({ enableToolBinding: false })({
    purpose: "guidance",
    activity: { activityKind: "guidance_analysis" },
    domain: "guidance",
    pluginFlow: "analysis",
    chain: "auxiliary",
    messages: [{ role: "user", content: "review" }],
    ctx,
  });

  const payload = committedEvents.find((event = {}) => event?.event === "authority_event_committed")
    ?.data?.envelope?.payload;
  assert.equal(payload?.eventType, "thinking");
  assert.equal(payload?.text, "guidance result");
  assert.equal(Object.hasOwn(payload, "output"), false);
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
  assert.equal(validateModelResponse(result), result);
  assert.equal(executed[0].name, "echo");
  assert.deepEqual(executed[0].args, { text: "hi" });
  assert.deepEqual(modelPort.requests[0].messages, [{ role: "user", content: "go" }]);
  const secondMessages = modelPort.requests[1].messages;
  assert.equal(secondMessages.length, 3);
  assert.equal(secondMessages[1].role, "assistant");
  assert.equal(secondMessages[1].tool_calls[0].id, "c1");
  assert.equal(secondMessages[2].role, "tool");
  assert.equal(secondMessages[2].content, "echo:hi");
  assert.deepEqual(modelPort.requests[0].options.toolBinding, { tool_choice: "auto" });
});

test("mini-runner returns rejected and missing tool facts to the final model call", async () => {
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
  assert.equal(validateModelResponse(result), result);
  const finalMessages = modelPort.requests.at(-1).messages;
  assert.match(finalMessages.at(-2).content, /tool not allowed: blocked/);
  assert.match(finalMessages.at(-1).content, /tool not found: missing/);
});

test("mini-runner isolates explicit model selection and plugin headers", async () => {
  const modelPort = createModelPort([{ text: "selected" }]);
  const { ctx } = createContext({ modelPort });
  let resolvedName = "";
  const invoker = createAgentCapabilityModelInvoker({
    enableToolBinding: false,
    configSnapshot: createConfigSnapshot(),
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
    reasoning_effort_parameter: "reasoning_effort",
    reasoning_effort_options: ["none", "low", "medium", "high"],
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

  assert.equal(result.output.text, "finalized");
  assert.equal(validateModelResponse(result), result);
  assert.equal(modelPort.requests.length, MAX_MINI_RUNNER_TOOL_TURNS + 1);
});

function bindPresentation(runtime) {
  runtime.userId = "test-user";
  runtime.sessionManager = createCanonicalMessageEventSessionManager();
  runtime.systemRuntime.sessionId = "session-test";
  runtime.systemRuntime.dialogProcessId = "dialog-test";
  bindAssistantMessageEventStream(runtime, {
    messageId: "message-test",
    presentationMessageId: "presentation-test",
  });
}

for (const streaming of [false, true]) {
  for (const mode of ["unbound", "tools", "finalize"]) {
    test(`explicit activity owns ${mode} presentation with streaming=${streaming}`, async () => {
      const output = { text: "review result", tokens: ["review ", "result"] };
      const tool = { name: "echo" };
      const outputs =
        mode === "unbound"
          ? [output]
          : [{ text: "", toolCalls: [{ id: "call-1", name: "echo", args: {} }] }, output];
      const modelPort = createModelPort(outputs);
      const events = [];
      const { ctx, runtime } = createContext({
        modelPort,
        tools: [tool],
        eventListener: { onEvent: (event) => events.push(event) },
      });
      runtime.runConfig = { streaming };
      bindPresentation(runtime);
      const response = await createInvoker({
        enableToolBinding: mode !== "unbound",
        maxTurns: mode === "finalize" ? 1 : 2,
        toolAllowlist: ["echo"],
        adaptToolsForBindingFn: () => ({ tools: [tool] }),
        executeToolCallFn: async () => ({ toolResultText: "tool result" }),
      })({ purpose: "third_party_review", activity: { activityKind: "custom_review" }, ctx });
      assert.equal(response.output.text, "review result");
      assert.ok(modelPort.requests.every((request) => request.options.streaming === streaming));
      const envelopes = events
        .filter((event) => event.event === "authority_event_committed")
        .map((event) => event.data.envelope);
      const payloads = envelopes.map((envelope) => envelope.payload);
      // Streaming emits fragments, then one completion; non-streaming emits only the completion.
      assert.deepEqual(
        payloads.map((payload) => payload.eventType),
        streaming ? ["activity_delta", "activity_delta", "thinking"] : ["thinking"],
      );
      assert.ok(payloads.every((payload) => payload.activityKind === "custom_review"));
      assert.equal(new Set(payloads.map((payload) => payload.activityId)).size, 1);
      const timeline = envelopes.reduce(reduceCanonicalActivityTimeline, []);
      assert.equal(timeline.length, 1);
      assert.equal(timeline[0].text, "review result");
      if (mode === "finalize") assert.equal(modelPort.requests.at(-1).tools, undefined);
    });
  }
}

test("a non-streaming provider result completes the explicitly requested streaming activity once", async () => {
  const modelPort = createModelPort([{ text: "whole result" }]);
  const events = [];
  const { ctx, runtime } = createContext({
    modelPort,
    eventListener: { onEvent: (event) => events.push(event) },
  });
  runtime.runConfig = { streaming: true };
  bindPresentation(runtime);
  await createInvoker()({ activity: { activityKind: "custom_review" }, ctx });
  const payloads = events
    .filter((event) => event.event === "authority_event_committed")
    .map((event) => event.data.envelope.payload);
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].eventType, "thinking");
  assert.equal(payloads[0].text, "whole result");
});

test("plugin purpose names never implicitly enable activity publication", async () => {
  const modelPort = createModelPort([{ text: "internal result", tokens: ["internal result"] }]);
  const events = [];
  const { ctx, runtime } = createContext({
    modelPort,
    eventListener: { onEvent: (event) => events.push(event) },
  });
  runtime.runConfig = { streaming: true };
  await createInvoker()({ purpose: "workflow_semantic", domain: "workflow", ctx });
  assert.equal(modelPort.requests[0].options.callbacks, undefined);
  assert.deepEqual(events, []);
});
