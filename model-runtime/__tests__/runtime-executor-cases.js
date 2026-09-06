/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  bindOpenAiCompatibleTools,
  compileProviderModelKwargs,
  createModelRequestExecutor,
  createOpenAiCompatibleClient,
  createProviderAdapterRegistry,
  applyPromptCacheMessages,
  convertMessages,
  convertToolChoice,
  convertTools,
  responseFromAnthropic,
  anthropicMessagesAdapter,
  classifyTransportError,
  orderOpenAiResponsesRequestBody,
  normalizeModelOutput,
} from "../src/index.js";
import {
  MODEL_CONTEXT_SEQUENCE_POLICY,
  MODEL_ERROR_KIND,
  MODEL_OPERATION_KIND,
} from "@noobot/model-protocol";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

const invocation = {
  requestId: "r",
  invocationId: "i",
  sessionId: "s",
  parentSessionId: "",
  dialogProcessId: "d",
  turnScopeId: "t",
  runId: "run",
  flow: "test",
  purpose: "test",
  domain: "test",
  contextSequencePolicy: MODEL_CONTEXT_SEQUENCE_POLICY.INDEPENDENT_REQUEST,
};
const model = {
  model: "m",
  operatorId: "test",
  adapterId: "test",
  capabilities: { web_search: true },
};

const sdkTool = {
  type: "function",
  function: {
    name: "execute_script",
    description: "execute script",
    parameters: { type: "object", properties: {} },
  },
};

test("transport errors classify nested Undici timeouts as retryable", () => {
  const headersTimeout = new TypeError("fetch failed", {
    cause: { code: "UND_ERR_HEADERS_TIMEOUT" },
  });
  assert.deepEqual(classifyTransportError(headersTimeout), {
    kind: MODEL_ERROR_KIND.TIMEOUT,
    retryable: true,
  });
  assert.deepEqual(anthropicMessagesAdapter.classifyError(headersTimeout), {
    kind: MODEL_ERROR_KIND.TIMEOUT,
    retryable: true,
  });
  assert.deepEqual(
    classifyTransportError({ name: "AbortError", code: "UND_ERR_HEADERS_TIMEOUT" }),
    { kind: MODEL_ERROR_KIND.ABORTED, retryable: false },
  );
});


test("transport errors classify temporary socket failures as retryable", () => {
  const socketFailure = new TypeError("fetch failed", {
    cause: { code: "ECONNRESET" },
  });
  assert.deepEqual(classifyTransportError(socketFailure), {
    kind: MODEL_ERROR_KIND.TEMPORARY_UNAVAILABLE,
    retryable: true,
  });
});


test("executor is the single attempt and retry authority", async () => {
  let attempts = 0;
  const adapter = {
    id: "openai-compatible",
    classifyError: () => ({ retryable: true }),
    createClient: () => ({
      invoke: async () => {
        attempts += 1;
        if (attempts === 1) {
          const error = new Error("temporary");
          error.status = 503;
          throw error;
        }
        return { content: "ok" };
      },
    }),
  };
  const port = createModelRequestExecutor({
    registry: { resolve: () => adapter },
    credentialPort: { resolve: () => "secret" },
    clock: { sleep: async () => {} },
  });
  const result = await port.invoke({
    invocation,
    model,
    messages: [],
    policies: { retry: { transport: { maxAttempts: 2, baseDelayMs: 0 } } },
  });
  assert.equal(result.output.text, "ok");
  assert.equal(result.execution.attemptCount, 2);
});


test("executor observation protocol cannot be overridden with model credentials", async () => {
  const events = [];
  const adapter = {
    id: "openai-compatible",
    classifyError: () => ({ retryable: false }),
    createClient: () => ({ invoke: async () => ({ content: "ok" }) }),
  };
  const port = createModelRequestExecutor({
    registry: { resolve: () => adapter },
    credentialPort: { resolve: () => "secret" },
    observationPort: { emit: (type, data) => events.push({ type, data }) },
  });
  await port.invoke({
    invocation,
    model: { ...model, api_key: "should-never-be-observed", base_url: "https://example.com/v1" },
    messages: [],
  });
  for (const event of events.filter(({ type }) => type.startsWith("model.invocation."))) {
    assert.equal("api_key" in event.data.model, false);
    assert.equal("base_url" in event.data.model, false);
  }
});


test("tool-call mismatch streaming downgrade is one-way within an invocation", async () => {
  const streamingAttempts = [];
  let calls = 0;
  const adapter = {
    id: "openai-compatible",
    classifyError: () => ({ retryable: false }),
    createClient: ({ streaming }) => {
      streamingAttempts.push(streaming);
      const client = {
        bindTools: () => client,
        invoke: async () => {
          calls += 1;
          return calls === 1
            ? { content: "", response_metadata: { finish_reason: "tool_calls" } }
            : {
                content: "",
                tool_calls: [{ id: "call_1", name: "execute_script", args: {} }],
                response_metadata: { finish_reason: "tool_calls" },
              };
        },
      };
      return client;
    },
  };
  const port = createModelRequestExecutor({
    registry: { resolve: () => adapter },
    credentialPort: { resolve: () => "secret" },
  });

  const response = await port.invoke({
    invocation,
    model,
    messages: [],
    tools: [sdkTool],
    options: { streaming: true },
    policies: { retry: { toolCallMismatch: { maxAttempts: 1, downgradeStreaming: true } } },
  });

  assert.deepEqual(streamingAttempts, [true, false]);
  assert.deepEqual(
    response.execution.attempts.map(({ streaming }) => streaming),
    [true, false],
  );
});


test("non-streaming invocation never enables streaming during semantic retries", async () => {
  const streamingAttempts = [];
  let calls = 0;
  const adapter = {
    id: "openai-compatible",
    classifyError: () => ({ retryable: false }),
    createClient: ({ streaming }) => {
      streamingAttempts.push(streaming);
      const client = {
        invoke: async () =>
          ++calls === 1
            ? { content: "", additional_kwargs: { reasoning_content: "thinking" } }
            : { content: "complete" },
      };
      return client;
    },
  };
  const port = createModelRequestExecutor({
    registry: { resolve: () => adapter },
    credentialPort: { resolve: () => "secret" },
  });

  await port.invoke({
    invocation,
    model,
    messages: [],
    options: { streaming: false },
    policies: { retry: { reasoningOnly: { maxAttempts: 1 } } },
  });

  assert.deepEqual(streamingAttempts, [false, false]);
});


test("tool calls are not discarded when the provider also returns reasoning", async () => {
  let calls = 0;
  const adapter = {
    id: "openai-compatible",
    classifyError: () => ({ retryable: false }),
    createClient: () => ({
      bindTools: function bindTools() {
        return this;
      },
      invoke: async () => {
        calls += 1;
        return {
          content: "",
          additional_kwargs: { reasoning_content: "thinking" },
          tool_calls: [{ id: "call_tool", name: "write_file", args: {} }],
        };
      },
    }),
  };
  const port = createModelRequestExecutor({
    registry: { resolve: () => adapter },
    credentialPort: { resolve: () => "secret" },
  });
  const response = await port.invoke({
    invocation,
    model,
    messages: [],
    tools: [sdkTool],
    options: { streaming: false },
    policies: { retry: { reasoningOnly: { maxAttempts: 1 } } },
  });
  assert.equal(calls, 1);
  assert.equal(response.output.toolCalls[0].id, "call_tool");
});


test("executor is the single model context trace authority at each provider attempt", async () => {
  const events = [];
  let attempts = 0;
  const adapter = {
    id: "openai-compatible",
    classifyError: () => ({ retryable: true }),
    createClient: () => {
      const client = {
        bindTools: () => client,
        invoke: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error("temporary");
          return { content: "ok" };
        },
      };
      return client;
    },
  };
  const port = createModelRequestExecutor({
    registry: { resolve: () => adapter },
    credentialPort: { resolve: () => "secret" },
    observationPort: { emit: (type, data) => events.push({ type, data }) },
    clock: { sleep: async () => {} },
  });

  await port.invoke({
    invocation,
    model: { ...model, alias: "primary" },
    messages: [{ role: "user", content: "hello", additional_kwargs: { noobotMessageId: "m1" } }],
    tools: [{ name: "read_file" }],
    metadata: { context: { summaryCheckpointRevision: 3 } },
    policies: { retry: { transport: { maxAttempts: 2, baseDelayMs: 0 } } },
  });

  const traces = events.filter(({ type }) => type === "model_context_trace");
  assert.equal(traces.length, 2);
  assert.deepEqual(
    traces.map(({ data }) => data.invocationSequence),
    [1, 2],
  );
  assert.equal(traces[0].data.stage, "llm_invoke_messages");
  assert.equal(traces[0].data.authority, "model_invoke_port");
  assert.equal(traces[0].data.protocolVersion, 2);
  assert.equal(
    traces[0].data.invocation.contextSequencePolicy,
    MODEL_CONTEXT_SEQUENCE_POLICY.INDEPENDENT_REQUEST,
  );
  assert.equal(traces[0].data.context.summaryCheckpointRevision, 3);
  assert.equal(traces[0].data.model.boundToolCount, 1);
  assert.equal(traces[0].data.messages.count, 1);
  assert.equal(traces[0].data.messages.missingMessageIdCount, 0);
  assert.match(traces[0].data.messages.sequenceHash, /^[a-f0-9]{64}$/);
  const invocationEvents = events.filter(({ type }) => type.startsWith("model.invocation."));
  assert.ok(invocationEvents.length > 0);
  for (const { data } of invocationEvents) {
    assert.deepEqual(data.model, {
      alias: "primary",
      model: model.model,
      operatorId: model.operatorId,
      modelFamily: "",
      adapterId: "openai-compatible",
    });
    assert.equal("api_key" in data.model, false);
    assert.equal("base_url" in data.model, false);
  }
});


test("provider registry resolves canonical adapter or model-family fact", () => {
  const registry = createProviderAdapterRegistry();
  assert.throws(() => registry.resolve({ adapterId: "dashscope" }), /unknown provider adapter/);
  assert.equal(registry.resolve({ adapterId: "openai-compatible" }).id, "openai-compatible");
  assert.throws(() => registry.resolve({}), /adapterId is required/);
  assert.throws(() => registry.resolve({ adapterId: "unknown" }), /unknown provider adapter/);
  assert.throws(() => registry.resolve({ adapterId: "dashscope" }), /unknown provider adapter/);
  assert.equal(registry.resolve({ modelFamily: "claude" }).id, "anthropic-messages");
  assert.equal(
    registry.resolve({ modelFamily: "claude", adapterId: "openai-compatible" }).id,
    "anthropic-messages",
  );
});


test("non-chat operations execute only through the resolved provider adapter", async () => {
  const calls = [];
  const adapter = {
    id: "openai-compatible",
    classifyError: () => ({ retryable: false }),
    createClient: () => ({ invoke: async () => ({ content: "unused" }) }),
    executeOperation: async ({ operation }) => {
      calls.push(operation);
      return { rawText: "searched", output: [{ type: "message" }] };
    },
  };
  const executor = createModelRequestExecutor({
    registry: { resolve: () => adapter },
    credentialPort: { resolve: () => "secret" },
  });
  const response = await executor.invoke({
    invocation,
    model,
    messages: [],
    operation: { kind: MODEL_OPERATION_KIND.WEB_SEARCH, input: { query: "latest" } },
  });
  assert.equal(calls.length, 1);
  assert.equal(response.operationKind, MODEL_OPERATION_KIND.WEB_SEARCH);
  assert.equal(response.result.rawText, "searched");

  const unsupported = createModelRequestExecutor({
    registry: { resolve: () => ({ ...adapter, executeOperation: undefined }) },
    credentialPort: { resolve: () => "secret" },
  });
  await assert.rejects(
    unsupported.invoke({
      invocation,
      model,
      messages: [],
      operation: { kind: MODEL_OPERATION_KIND.WEB_SEARCH, input: { query: "latest" } },
    }),
    /provider adapter openai-compatible does not support operation: web_search/,
  );
});

