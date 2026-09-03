/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPromptCacheKey,
  bindOpenAiCompatibleTools,
  compileProviderModelKwargs,
  createModelRequestExecutor,
  createOpenAiCompatibleClient,
  createProviderAdapterRegistry,
  applyPromptCacheMessages,
  resolveUseResponsesApi,
} from "../src/index.js";
import { MODEL_CONTEXT_SEQUENCE_POLICY, MODEL_OPERATION_KIND } from "@noobot/model-protocol";

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

test("openai-compatible adapter applies bound invocation overrides without mutating model defaults", () => {
  const client = createOpenAiCompatibleClient({
    credential: "test-key",
    modelSpec: {
      model: "gpt-5.5",
      reasoning_effort_parameter: "reasoning_effort",
      reasoning_effort_options: ["none", "low", "medium", "high", "xhigh", "max"],
      operatorId: "openai",
      adapterId: "openai-compatible",
      base_url: "http://localhost",
      reasoning_effort: "high",
    },
  });
  const bound = bindOpenAiCompatibleTools(client, [sdkTool], {}, { reasoning_effort: "low" });

  assert.equal(client.invocationParams({}).reasoning_effort, "high");
  assert.equal(bound.invocationParams({}).reasoning_effort, "low");
});

test("openai-compatible GPT cache protocol is compiled independently of operator identity", () => {
  const client = createOpenAiCompatibleClient({
    credential: "test-key",
    flow: "agent.main",
    modelSpec: {
      model: "gpt-5.6-sol",
      reasoning_effort_parameter: "reasoning_effort",
      reasoning_effort_options: ["none", "low", "medium", "high", "xhigh", "max"],
      modelFamily: "gpt",
      operatorId: "generic",
      adapterId: "openai-compatible",
      base_url: "http://localhost",
    },
  });
  const params = client.invocationParams({});

  assert.equal(params.prompt_cache_key, "noobot-main-gpt-5-6-sol");
  assert.deepEqual(params.prompt_cache_options, { ttl: "30m" });
});

test("xAI Grok cache protocol emits a stable prompt cache key without GPT-only options", () => {
  const grok = compileProviderModelKwargs(
    {
      operatorId: "generic",
      adapterId: "openai-compatible",
      model: "grok-4.6",
      reasoning_effort_parameter: "reasoning_effort",
      reasoning_effort_options: ["none", "low", "medium", "high", "xhigh", "max"],
      modelFamily: "grok",
    },
    "agent.main",
  );

  assert.equal(grok.prompt_cache_key, undefined);
  assert.equal("prompt_cache_options" in grok, false);
  assert.equal("prompt_cache_retention" in grok, false);
  const grokClient = createOpenAiCompatibleClient({
    credential: "test-key",
    modelSpec: {
      model: "grok-4.6",
      base_url: "http://localhost",
      reasoning_effort_parameter: "reasoning_effort",
      reasoning_effort_options: ["none", "low", "medium", "high", "xhigh"],
    },
  });
  assert.equal(grokClient.clientConfig.defaultHeaders["x-grok-conv-id"], "noobot-main-grok-4-6");
});

test("normalized Grok clients use the xAI cache key protocol for each flow", () => {
  const client = createOpenAiCompatibleClient({
    credential: "test-key",
    flow: "plugin.analysis",
    modelSpec: {
      model: "grok-4.6",
      reasoning_effort_parameter: "reasoning_effort",
      reasoning_effort_options: ["none", "low", "medium", "high", "xhigh", "max"],
      base_url: "http://localhost",
    },
  });
  const params = client.invocationParams({});

  assert.equal(params.prompt_cache_key, undefined);
  assert.equal(params.prompt_cache_options, undefined);
  assert.equal(params.prompt_cache_retention, undefined);
  assert.equal(
    client.clientConfig.defaultHeaders["x-grok-conv-id"],
    "noobot-plugin-analysis-grok-4-6",
  );
});

test("Qwen uses the canonical OpenAI-compatible invocation", () => {
  const client = createOpenAiCompatibleClient({
    credential: "test-key",
    modelSpec: {
      model: "qwen3.6-plus",
      reasoning_effort_parameter: "enable_thinking",
      reasoning_effort_options: ["none", "medium"],
      operatorId: "generic",
      adapterId: "openai-compatible",
      base_url: "http://localhost",
    },
  });
  const bound = bindOpenAiCompatibleTools(client, [sdkTool], {}, { reasoning_effort: "low" });
  const params = bound.invocationParams({});

  assert.equal(params.reasoning_effort, "low");
});

test("Claude and Qwen cache markers are message-level and immutable", () => {
  const messages = [
    { role: "system", content: "stable instructions" },
    { role: "user", content: "question" },
  ];
  const marked = applyPromptCacheMessages(
    { model: "claude-sonnet-5", modelFamily: "claude" },
    messages,
  );
  assert.deepEqual(messages[0], { role: "system", content: "stable instructions" });
  assert.deepEqual(marked[0].content, [
    { type: "text", text: "stable instructions", cache_control: { type: "ephemeral" } },
  ]);
  const qwenBlocks = applyPromptCacheMessages({ model: "qwen3.7-max", modelFamily: "qwen" }, [
    {
      role: "system",
      content: [
        { type: "text", text: "a" },
        { type: "image_url", image_url: "x" },
      ],
    },
  ]);
  assert.deepEqual(qwenBlocks[0].content[0], {
    type: "text",
    text: "a",
    cache_control: { type: "ephemeral" },
  });
  assert.deepEqual(qwenBlocks[0].content[1], { type: "image_url", image_url: "x" });
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

test("provider registry resolves only the explicit adapter identity", () => {
  const registry = createProviderAdapterRegistry();
  assert.throws(() => registry.resolve({ adapterId: "dashscope" }), /unknown provider adapter/);
  assert.equal(registry.resolve({ adapterId: "openai-compatible" }).id, "openai-compatible");
  assert.throws(() => registry.resolve({}), /adapterId is required/);
  assert.throws(() => registry.resolve({ adapterId: "unknown" }), /unknown provider adapter/);
  assert.throws(() => registry.resolve({ adapterId: "dashscope" }), /unknown provider adapter/);
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

test("cache parameters are isolated by interface protocol, model family, and operator", () => {
  const common = { adapterId: "openai-compatible", modelFamily: "gpt" };
  const openAi = compileProviderModelKwargs(
    {
      ...common,
      operatorId: "openai",
      model: "gpt-5.6",
      reasoning_effort_parameter: "reasoning_effort",
      reasoning_effort_options: ["none", "low", "medium", "high", "xhigh", "max"],
      modelFamily: "gpt",
      extra_body: { cached_content: "leak", cache_control: { type: "ephemeral" } },
    },
    "workflow.plan",
  );
  assert.equal(openAi.prompt_cache_key, "noobot-workflow-plan-gpt-5-6");
  assert.deepEqual(openAi.prompt_cache_options, { ttl: "30m" });
  assert.equal("cached_content" in openAi, false);
  assert.equal("cache_control" in openAi, false);

  const anthropic = compileProviderModelKwargs({
    ...common,
    operatorId: "anthropic",
    model: "claude-opus",
    modelFamily: "claude",
    reasoning_effort_parameter: "reasoning_effort",
    reasoning_effort_options: ["none", "low", "medium", "high", "xhigh", "max"],
    extra_body: { prompt_cache_key: "leak", cached_content: "leak" },
  });
  assert.deepEqual(anthropic, {});

  const gemini = compileProviderModelKwargs({
    ...common,
    operatorId: "gemini",
    model: "gemini-pro",
    modelFamily: "gemini",
    reasoning_effort_parameter: "thinking_level",
    reasoning_effort_options: ["low", "medium", "high"],
    cached_content: "cachedContents/1",
    extra_body: { prompt_cache_retention: "leak", cache_control: { type: "ephemeral" } },
  });
  assert.deepEqual(gemini, { cached_content: "cachedContents/1" });

  const deepseek = compileProviderModelKwargs({
    ...common,
    operatorId: "deepseek",
    model: "deepseek-chat",
    modelFamily: "deepseek",
    reasoning_effort_parameter: "reasoning_effort",
    reasoning_effort_options: ["none", "low", "medium", "high", "xhigh", "max"],
    extra_body: { prompt_cache_key: "leak", cache_control: { type: "ephemeral" } },
  });
  assert.deepEqual(deepseek, {});

  const alibaba = compileProviderModelKwargs({
    operatorId: "alibaba",
    adapterId: "openai-compatible",
    modelFamily: "qwen",
    model: "qwen-max",
    reasoning_effort_parameter: "enable_thinking",
    reasoning_effort_options: ["none", "medium"],
    extra_body: { prompt_cache_retention: "leak" },
  });
  assert.deepEqual(alibaba, {});
});

test("model defaults follow provider-specific sampling guidance", async () => {
  const { normalizeRuntimeModelSpec } = await import("../src/normalization/spec-normalizer.js");
  const openai = normalizeRuntimeModelSpec({
    model: "gpt-5.6",
    reasoning_effort_parameter: "reasoning_effort",
    reasoning_effort_options: ["none", "low", "medium", "high", "xhigh", "max"],
    operatorId: "openai",
    adapterId: "openai-compatible",
  });
  assert.deepEqual(
    {
      temperature: openai.temperature,
      top_p: openai.top_p,
      frequency_penalty: openai.frequency_penalty,
    },
    { temperature: 0.7, top_p: undefined, frequency_penalty: undefined },
  );
  const openaiTopP = normalizeRuntimeModelSpec({
    model: "gpt-4.1",
    reasoning_effort_parameter: "reasoning_effort",
    reasoning_effort_options: ["none", "low", "medium", "high", "xhigh", "max"],
    operatorId: "openai",
    adapterId: "openai-compatible",
    top_p: 0.9,
  });
  assert.deepEqual(
    { temperature: openaiTopP.temperature, top_p: openaiTopP.top_p },
    { temperature: undefined, top_p: 0.9 },
  );
  const qwen = normalizeRuntimeModelSpec({
    model: "qwen3.6-plus",
    reasoning_effort_parameter: "enable_thinking",
    reasoning_effort_options: ["none", "medium"],
    operatorId: "alibaba",
    adapterId: "openai-compatible",
  });
  assert.deepEqual(
    { temperature: qwen.temperature, top_p: qwen.top_p, top_k: qwen.top_k, min_p: qwen.min_p },
    { temperature: 0.7, top_p: 0.8, top_k: 20, min_p: 0 },
  );
  const thinking = normalizeRuntimeModelSpec({
    model: "qwen3.6-plus",
    reasoning_effort_parameter: "enable_thinking",
    reasoning_effort_options: ["none", "medium"],
    operatorId: "alibaba",
    adapterId: "openai-compatible",
  });
  assert.deepEqual(
    { temperature: thinking.temperature, top_p: thinking.top_p, top_k: thinking.top_k },
    { temperature: 0.7, top_p: 0.8, top_k: 20 },
  );
});

test("runtime model normalization rejects invalid parameter facts instead of converting them", async () => {
  const { normalizeRuntimeModelSpec } = await import("../src/normalization/spec-normalizer.js");
  assert.throws(
    () =>
      normalizeRuntimeModelSpec({
        model: "gpt-5.6",
        reasoning_effort_parameter: "reasoning_effort",
        reasoning_effort_options: ["none", "low", "medium", "high", "xhigh", "max"],
        temperature: "0.8",
      }),
    /temperature must be a number/,
  );
  assert.throws(
    () =>
      normalizeRuntimeModelSpec({
        model: "gpt-5.6",
        reasoning_effort_parameter: "reasoning_effort",
        reasoning_effort_options: ["none", "low", "medium", "high", "xhigh", "max"],
        top_p: 2,
      }),
    /top_p must be a number between/,
  );
  assert.throws(
    () =>
      normalizeRuntimeModelSpec({
        model: "gpt-5.6",
        reasoning_effort_parameter: "reasoning_effort",
        reasoning_effort_options: ["none", "low", "medium", "high", "xhigh", "max"],
        max_tokens: 10.5,
      }),
    /max_tokens must be a positive integer/,
  );
});

test("reasoning effort remains controlled by model configuration", async () => {
  const { normalizeRuntimeModelSpec } = await import("../src/normalization/spec-normalizer.js");
  const spec = normalizeRuntimeModelSpec({
    model: "ZHIPU/GLM-5.3",
    reasoning_effort_parameter: "reasoning_effort",
    reasoning_effort_options: ["none", "low", "medium", "high", "xhigh", "max"],
    reasoning_effort: "medium",
  });
  assert.equal(spec.reasoning_effort, "medium");
});

test("reasoning effort defaults and invalid values follow model options", async () => {
  const { normalizeRuntimeModelSpec } = await import("../src/normalization/spec-normalizer.js");
  const glm = normalizeRuntimeModelSpec({
    model: "glm-5.3",
    reasoning_effort_parameter: "reasoning_effort",
    reasoning_effort_options: ["low", "high", "max"],
    reasoning_effort: "invalid",
    tool_reasoning_effort: "invalid",
  });
  assert.deepEqual(glm.reasoning_effort_options, ["low", "high", "max"]);
  assert.equal(glm.reasoning_effort, "low");
  assert.equal(glm.tool_reasoning_effort, "low");
  // A spec without declared reasoning facts never reaches the transport with an
  // invented default: config repair fills them from the library template first.
  assert.throws(
    () => normalizeRuntimeModelSpec({ model: "custom" }),
    /reasoning_effort_options is required/,
  );
});

test("normalized ordinary requests compile their configured reasoning effort", async () => {
  const { normalizeRuntimeModelSpec } = await import("../src/normalization/spec-normalizer.js");
  const { compileProviderModelKwargs } = await import("../src/policies/cache-policy-engine.js");
  const spec = normalizeRuntimeModelSpec({
    model: "grok-4.6",
    reasoning_effort_parameter: "reasoning_effort",
    reasoning_effort_options: ["none", "low", "medium", "high", "xhigh", "max"],
    reasoning_effort: "high",
  });
  assert.equal(compileProviderModelKwargs(spec).reasoning_effort, "high");
});

test("model series use their provider reasoning parameter names", async () => {
  const { compileProviderModelKwargs } = await import("../src/policies/cache-policy-engine.js");
  const common = {
    operatorId: "google",
    modelFamily: "gemini",
    model: "gemini-3.7-flash",
    reasoning_effort_parameter: "thinking_level",
    reasoning_effort_options: ["low", "medium", "high"],
    reasoning_effort: "medium",
  };
  assert.equal(compileProviderModelKwargs(common).thinking_level, "medium");
  assert.equal(
    compileProviderModelKwargs({
      operatorId: "alibaba",
      modelFamily: "qwen",
      model: "qwen3.7-plus",
      reasoning_effort_parameter: "enable_thinking",
      reasoning_effort_options: ["none", "medium"],
      reasoning_effort: "high",
    }).enable_thinking,
    true,
  );
  assert.equal(
    compileProviderModelKwargs({
      operatorId: "alibaba",
      modelFamily: "qwen",
      model: "qwen3.7-plus",
      reasoning_effort_parameter: "enable_thinking",
      reasoning_effort_options: ["none", "medium"],
      reasoning_effort: "none",
    }).enable_thinking,
    false,
  );
});

test("multimodal generation transport remains an explicit configured fact", async () => {
  const { normalizeRuntimeModelSpec } = await import("../src/normalization/spec-normalizer.js");
  const unconfigured = normalizeRuntimeModelSpec({
    model: "gpt-image-2",
    reasoning_effort_parameter: "reasoning_effort",
    reasoning_effort_options: ["none", "low", "medium", "high", "xhigh", "max"],
    multimodal_generation: {
      support_generation: { enabled: true, support_scope: ["image"] },
    },
  });
  assert.equal(unconfigured.multimodal_generation.support_generation.api_type, undefined);

  const explicit = normalizeRuntimeModelSpec({
    model: "gpt-image-2",
    reasoning_effort_parameter: "reasoning_effort",
    reasoning_effort_options: ["none", "low", "medium", "high", "xhigh", "max"],
    multimodal_generation: {
      support_generation: {
        enabled: true,
        support_scope: ["image"],
        api_type: "openai_responses",
      },
    },
  });
  assert.equal(explicit.multimodal_generation.support_generation.api_type, "openai_responses");
});

test("model identity and defaults layer operator, family, concrete model, then explicit config", async () => {
  const { normalizeRuntimeModelSpec } = await import("../src/normalization/spec-normalizer.js");
  const proxiedGpt = normalizeRuntimeModelSpec({
    model: "gpt-5.6-sol",
    reasoning_effort_parameter: "reasoning_effort",
    reasoning_effort_options: ["none", "low", "medium", "high", "xhigh", "max"],
    base_url: "https://third-party.example.com/v1",
    modelFamily: "qwen",
    adapterId: "openai-compatible",
  });
  assert.equal(proxiedGpt.operatorId, "generic");
  assert.equal(proxiedGpt.modelFamily, "gpt");
  assert.equal(proxiedGpt.adapterId, "openai-compatible");
  assert.equal(proxiedGpt.temperature, 0.7);

  const explicit = normalizeRuntimeModelSpec({
    model: "qwen3-thinking",
    reasoning_effort_parameter: "enable_thinking",
    reasoning_effort_options: ["none", "medium"],
    base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    temperature: 0.2,
    top_p: 0.7,
  });
  assert.equal(explicit.operatorId, "alibaba");
  assert.equal(explicit.modelFamily, "qwen");
  assert.equal(explicit.temperature, 0.2);
  assert.equal(explicit.top_p, 0.7);
  assert.equal(explicit.top_k, 20);

  const proxiedGlm = normalizeRuntimeModelSpec({
    model: "ZHIPU/GLM-5.1",
    reasoning_effort_parameter: "reasoning_effort",
    reasoning_effort_options: ["none", "low", "medium", "high", "xhigh", "max"],
    base_url: "https://api.zhipu.ai/v4",
  });
  assert.equal(proxiedGlm.operatorId, "generic");
  assert.equal(proxiedGlm.modelFamily, "glm");
  assert.equal(proxiedGlm.adapterId, "openai-compatible");
  assert.equal("format" in proxiedGlm, false);
});

test("reasoning-only exhaustion is a typed terminal protocol error", async () => {
  const adapter = {
    id: "openai-compatible",
    classifyError: () => ({ retryable: false }),
    createClient: () => ({
      invoke: async () => ({ content: "", additional_kwargs: { reasoning_content: "thinking" } }),
    }),
  };
  const port = createModelRequestExecutor({
    registry: { resolve: () => adapter },
    credentialPort: { resolve: () => "secret" },
  });
  await assert.rejects(
    port.invoke({
      invocation,
      model,
      messages: [],
      policies: { retry: { reasoningOnly: { maxAttempts: 1 } } },
    }),
    (error) =>
      error?.code === "MODEL_REASONING_RETRY_EXHAUSTED" && error?.kind === "reasoning_only",
  );
});

test("reasoning-only retries are exposed through the canonical attempt trace", async () => {
  let calls = 0;
  const adapter = {
    id: "openai-compatible",
    classifyError: () => ({ retryable: false }),
    createClient: () => ({
      invoke: async () =>
        ++calls === 1
          ? { content: "", additional_kwargs: { reasoning_content: "thinking" } }
          : { content: "final answer" },
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
    policies: { retry: { reasoningOnly: { maxAttempts: 1 } } },
  });
  assert.equal(response.output.text, "final answer");
  assert.equal(response.execution.attemptCount, 2);
  assert.deepEqual(
    response.execution.attempts.map(({ status, kind }) => ({ status, kind })),
    [
      { status: "retry", kind: "reasoning_only" },
      { status: "completed", kind: "response" },
    ],
  );
  assert.equal(response.execution.attempts[0].output.reasoning, "thinking");
});

test("responses API and cache key selection are deterministic", () => {
  assert.equal(resolveUseResponsesApi({ model: "codex-mini" }), true);
  assert.equal(
    resolveUseResponsesApi({
      model: "qwen-max",
      reasoning_effort_parameter: "enable_thinking",
      reasoning_effort_options: ["none", "medium"],
      use_responses_api: true,
    }),
    true,
  );
  assert.equal(resolveUseResponsesApi({ model: "gpt-5" }), false);
  assert.equal(
    buildPromptCacheKey(
      {
        operatorId: "openai",
        model: "gpt-5",
        reasoning_effort_parameter: "reasoning_effort",
        reasoning_effort_options: ["none", "low", "medium", "high", "xhigh", "max"],
        modelFamily: "gpt",
      },
      "agent.main",
    ),
    "noobot-main-gpt-5",
  );
});
