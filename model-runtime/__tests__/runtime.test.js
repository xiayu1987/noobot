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
  format: "openai_compatible",
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
      format: "openai_compatible",
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
      modelFamily: "gpt",
      format: "openai_compatible",
      operatorId: "generic",
      adapterId: "openai-compatible",
      base_url: "http://localhost",
    },
  });
  const params = client.invocationParams({});

  assert.equal(params.prompt_cache_key, "noobot-main-gpt-5-6-sol");
  assert.deepEqual(params.prompt_cache_options, { ttl: "30m" });
});

test("legacy DashScope model specs are migrated to OpenAI-compatible invocation", () => {
  const client = createOpenAiCompatibleClient({
    credential: "test-key",
    modelSpec: {
      model: "qwen3.6-plus",
      format: "openai_compatible",
      operatorId: "generic",
      adapterId: "openai-compatible",
      base_url: "http://localhost",
    },
  });
  const bound = bindOpenAiCompatibleTools(client, [sdkTool], {}, { reasoning_effort: "low" });
  const params = bound.invocationParams({});

  assert.equal(params.reasoning_effort, "low");
});

test("executor is the single attempt and retry authority", async () => {
  let attempts = 0;
  const adapter = {
    id: "openai-compatible",
    formats: ["openai_compatible"],
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

test("tool-call mismatch streaming downgrade is one-way within an invocation", async () => {
  const streamingAttempts = [];
  let calls = 0;
  const adapter = {
    id: "openai-compatible",
    formats: ["openai_compatible"],
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
    formats: ["openai_compatible"],
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
    formats: ["openai_compatible"],
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
    formats: ["openai_compatible"],
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
});

test("provider registry resolves only the explicit adapter identity", () => {
  const registry = createProviderAdapterRegistry();
  assert.throws(
    () => registry.resolve({ adapterId: "dashscope", format: "openai_compatible" }),
    /unknown provider adapter/,
  );
  assert.equal(
    registry.resolve({ adapterId: "openai-compatible", format: "openai_compatible" }).id,
    "openai-compatible",
  );
  assert.throws(() => registry.resolve({ format: "openai_compatible" }), /adapterId is required/);
  assert.throws(
    () => registry.resolve({ adapterId: "unknown", format: "openai_compatible" }),
    /unknown provider adapter/,
  );
  assert.throws(
    () => registry.resolve({ adapterId: "dashscope", format: "openai_compatible" }),
    /unknown provider adapter/,
  );
});

test("non-chat operations execute only through the resolved provider adapter", async () => {
  const calls = [];
  const adapter = {
    id: "openai-compatible",
    formats: ["openai_compatible"],
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
  const common = { format: "openai_compatible", adapterId: "openai-compatible" };
  const openAi = compileProviderModelKwargs(
    {
      ...common,
      operatorId: "openai",
      model: "gpt-5.6",
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
    extra_body: { prompt_cache_key: "leak", cached_content: "leak" },
  });
  assert.deepEqual(anthropic, { cache_control: { type: "ephemeral" } });

  const gemini = compileProviderModelKwargs({
    ...common,
    operatorId: "gemini",
    model: "gemini-pro",
    cached_content: "cachedContents/1",
    extra_body: { prompt_cache_retention: "leak", cache_control: { type: "ephemeral" } },
  });
  assert.deepEqual(gemini, { cached_content: "cachedContents/1" });

  const deepseek = compileProviderModelKwargs({
    ...common,
    operatorId: "deepseek",
    model: "deepseek-chat",
    extra_body: { prompt_cache_key: "leak", cache_control: { type: "ephemeral" } },
  });
  assert.deepEqual(deepseek, {});

  const dashscope = compileProviderModelKwargs({
    format: "openai_compatible",
    operatorId: "dashscope",
    adapterId: "dashscope",
    model: "qwen-max",
    enable_thinking: true,
    preserve_thinking: false,
    thinking_budget: 2000,
    extra_body: { prompt_cache_retention: "leak" },
  });
  assert.deepEqual(dashscope, {});
});

test("model defaults follow provider-specific sampling guidance", async () => {
  const { normalizeRuntimeModelSpec } = await import("../src/normalization/spec-normalizer.js");
  const openai = normalizeRuntimeModelSpec({
    model: "gpt-5.6",
    format: "openai_compatible",
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
    format: "openai_compatible",
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
    format: "openai_compatible",
    operatorId: "dashscope",
    adapterId: "dashscope",
  });
  assert.deepEqual(
    { temperature: qwen.temperature, top_p: qwen.top_p, top_k: qwen.top_k, min_p: qwen.min_p },
    { temperature: 0.7, top_p: 0.8, top_k: 20, min_p: 0 },
  );
  const thinking = normalizeRuntimeModelSpec({
    model: "qwen3.6-plus",
    format: "openai_compatible",
    operatorId: "dashscope",
    adapterId: "dashscope",
    enable_thinking: true,
  });
  assert.deepEqual(
    { temperature: thinking.temperature, top_p: thinking.top_p, top_k: thinking.top_k },
    { temperature: 0.7, top_p: 0.8, top_k: 20 },
  );
});

test("reasoning effort remains controlled by model configuration", async () => {
  const { normalizeRuntimeModelSpec } = await import("../src/normalization/spec-normalizer.js");
  const spec = normalizeRuntimeModelSpec({
    model: "ZHIPU/GLM-5.3",
    format: "openai_compatible",
    preserve_thinking: false,
    enable_thinking: false,
    thinking_budget: 0,
    reasoning_effort: "medium",
  });
  assert.equal(spec.reasoning_effort, "medium");
  assert.equal(spec.enable_thinking, false);
  assert.equal(spec.preserve_thinking, false);
  assert.equal(spec.thinking_budget, 0);
});

test("multimodal generation transport remains an explicit configured fact", async () => {
  const { normalizeRuntimeModelSpec } = await import("../src/normalization/spec-normalizer.js");
  const unconfigured = normalizeRuntimeModelSpec({
    model: "gpt-image-2",
    format: "openai_compatible",
    multimodal_generation: {
      support_generation: { enabled: true, support_scope: ["image"] },
    },
  });
  assert.equal(unconfigured.multimodal_generation.support_generation.api_type, undefined);

  const explicit = normalizeRuntimeModelSpec({
    model: "gpt-image-2",
    format: "openai_compatible",
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
    format: "openai_compatible",
    base_url: "https://third-party.example.com/v1",
    modelFamily: "qwen",
    adapterId: "dashscope",
  });
  assert.equal(proxiedGpt.operatorId, "generic");
  assert.equal(proxiedGpt.modelFamily, "gpt");
  assert.equal(proxiedGpt.adapterId, "openai-compatible");
  assert.equal(proxiedGpt.temperature, 0.7);

  const explicit = normalizeRuntimeModelSpec({
    model: "qwen3-thinking",
    format: "openai_compatible",
    base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    enable_thinking: true,
    temperature: 0.2,
    top_p: 0.7,
  });
  assert.equal(explicit.operatorId, "alibaba");
  assert.equal(explicit.modelFamily, "qwen");
  assert.equal(explicit.temperature, 0.2);
  assert.equal(explicit.top_p, 0.7);
  assert.equal(explicit.top_k, 20);

  const dashscopeGlm = normalizeRuntimeModelSpec({
    model: "ZHIPU/GLM-5.1",
    format: "openai_compatible",
    base_url: "https://api.zhipu.ai/v4",
  });
  assert.equal(dashscopeGlm.operatorId, "generic");
  assert.equal(dashscopeGlm.modelFamily, "glm");
  assert.equal(dashscopeGlm.adapterId, "openai-compatible");
  assert.equal(dashscopeGlm.format, "openai_compatible");
});

test("reasoning-only exhaustion is a typed terminal protocol error", async () => {
  const adapter = {
    id: "openai-compatible",
    formats: ["openai_compatible"],
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
    formats: ["openai_compatible"],
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
  assert.equal(resolveUseResponsesApi({ format: "openai_compatible", model: "codex-mini" }), true);
  assert.equal(
    resolveUseResponsesApi({
      format: "openai_compatible",
      model: "qwen-max",
      use_responses_api: true,
    }),
    true,
  );
  assert.equal(resolveUseResponsesApi({ format: "openai_compatible", model: "gpt-5" }), false);
  assert.equal(
    buildPromptCacheKey(
      {
        operatorId: "openai",
        model: "gpt-5",
        modelFamily: "gpt",
        format: "openai_compatible",
      },
      "agent.main",
    ),
    "noobot-main-gpt-5",
  );
});
