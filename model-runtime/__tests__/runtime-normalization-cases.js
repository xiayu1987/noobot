/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { compileProviderModelKwargs, createModelRequestExecutor } from "../src/index.js";
import { MODEL_CONTEXT_SEQUENCE_POLICY } from "@noobot/model-protocol";

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

test("cache parameters use the shared strategy while retaining provider-specific fields", () => {
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
  assert.deepEqual(anthropic, {
    prompt_cache_key: "noobot-main-claude-opus",
    prompt_cache_retention: "24h",
    cache_control: { type: "ephemeral" },
  });

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
  assert.deepEqual(gemini, {
    cached_content: "cachedContents/1",
  });

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

test("adapter identity comes from model-family facts and ignores config overrides", async () => {
  const { normalizeRuntimeModelSpec } = await import("../src/normalization/spec-normalizer.js");
  const claude = normalizeRuntimeModelSpec({
    model: "claude-fable-5-1",
    adapter_id: "openai-compatible",
    adapterId: "openai-compatible",
    reasoning_effort_parameter: "reasoning_effort",
    reasoning_effort_options: ["none", "low", "medium"],
  });
  assert.equal(claude.modelFamily, "claude");
  assert.equal(claude.adapterId, "anthropic-messages");
  assert.equal("adapter_id" in claude, false);
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
