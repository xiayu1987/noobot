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
const model = { model: "m", format: "test", providerId: "test", adapterId: "test" };

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
      providerId: "openai",
      adapterId: "openai-compatible",
      base_url: "http://localhost",
      reasoning_effort: "high",
    },
  });
  const bound = bindOpenAiCompatibleTools(client, [sdkTool], {}, { reasoning_effort: "low" });

  assert.equal(client.invocationParams({}).reasoning_effort, "high");
  assert.equal(bound.invocationParams({}).reasoning_effort, "low");
});

test("dashscope-compatible adapter applies non-thinking invocation overrides", () => {
  const client = createOpenAiCompatibleClient({
    credential: "test-key",
    modelSpec: {
      model: "qwen3.6-plus",
      format: "dashscope",
      providerId: "dashscope",
      adapterId: "dashscope",
      base_url: "http://localhost",
      preserve_thinking: true,
      thinking_budget: 1024,
    },
  });
  const bound = bindOpenAiCompatibleTools(
    client,
    [sdkTool],
    {},
    { preserve_thinking: false, thinking_budget: 0 },
  );
  const params = bound.invocationParams({});

  assert.equal(client.invocationParams({}).preserve_thinking, true);
  assert.equal(client.invocationParams({}).thinking_budget, 1024);
  assert.equal(params.preserve_thinking, false);
  assert.equal(params.thinking_budget, 0);
});

test("executor is the single attempt and retry authority", async () => {
  let attempts = 0;
  const adapter = {
    id: "test",
    formats: ["test"],
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

test("executor is the single model context trace authority at each provider attempt", async () => {
  const events = [];
  let attempts = 0;
  const adapter = {
    id: "test",
    formats: ["test"],
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
  assert.equal(registry.resolve({ adapterId: "dashscope", format: "dashscope" }).id, "dashscope");
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
    /does not support format/,
  );
});

test("non-chat operations execute only through the resolved provider adapter", async () => {
  const calls = [];
  const adapter = {
    id: "test",
    formats: ["test"],
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
    /provider adapter test does not support operation: web_search/,
  );
});

test("provider cache parameters are isolated by explicit provider identity", () => {
  const common = { format: "openai_compatible", adapterId: "openai-compatible" };
  const openAi = compileProviderModelKwargs(
    {
      ...common,
      providerId: "openai",
      model: "gpt-5.6",
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
    providerId: "anthropic",
    model: "claude-opus",
    extra_body: { prompt_cache_key: "leak", cached_content: "leak" },
  });
  assert.deepEqual(anthropic, { cache_control: { type: "ephemeral" } });

  const gemini = compileProviderModelKwargs({
    ...common,
    providerId: "gemini",
    model: "gemini-pro",
    cached_content: "cachedContents/1",
    extra_body: { prompt_cache_retention: "leak", cache_control: { type: "ephemeral" } },
  });
  assert.deepEqual(gemini, { cached_content: "cachedContents/1" });

  const deepseek = compileProviderModelKwargs({
    ...common,
    providerId: "deepseek",
    model: "deepseek-chat",
    extra_body: { prompt_cache_key: "leak", cache_control: { type: "ephemeral" } },
  });
  assert.deepEqual(deepseek, {});

  const dashscope = compileProviderModelKwargs({
    format: "dashscope",
    providerId: "dashscope",
    adapterId: "dashscope",
    model: "qwen-max",
    enable_thinking: true,
    preserve_thinking: false,
    thinking_budget: 2000,
    extra_body: { prompt_cache_retention: "leak" },
  });
  assert.deepEqual(dashscope, {
    enable_thinking: true,
    preserve_thinking: false,
    thinking_budget: 2000,
  });
});

test("reasoning-only exhaustion is a typed terminal protocol error", async () => {
  const adapter = {
    id: "test",
    formats: ["test"],
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
    id: "test",
    formats: ["test"],
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
    resolveUseResponsesApi({ format: "dashscope", model: "qwen-max", use_responses_api: true }),
    true,
  );
  assert.equal(resolveUseResponsesApi({ format: "openai_compatible", model: "gpt-5" }), false);
  assert.equal(
    buildPromptCacheKey({ providerId: "openai", model: "gpt-5" }, "agent.main"),
    "noobot-main-gpt-5",
  );
});
