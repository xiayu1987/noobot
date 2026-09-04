/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildModelReasoningEffortTransport,
  createModelRequest,
  createModelResponse,
  MODEL_CONTEXT_SEQUENCE_POLICY,
  MODEL_INPUT_PROCESSING_KIND,
  MODEL_OPERATION_KIND,
  MODEL_PROTOCOL_VERSION,
  normalizeModelReasoningConfiguration,
  resolveModelMinimumReasoningEffort,
  listModelLibraryOptions,
  resolveDefaultModelLibraryProvider,
  resolveModelLibraryProvider,
  normalizeModelCapabilities,
  resolveModelMultimodalCapabilities,
  classifyModelInputProcessing,
  supportsModelMultimodalGeneration,
  supportsModelMultimodalParsing,
  supportsModelCapability,
  validateModelResponse,
} from "../src/index.js";

test("model input processing keeps directly readable text out of multimodal parsing", () => {
  for (const mimeType of [
    "text/plain",
    "text/csv; charset=utf-8",
    "application/csv",
    "application/json",
    "application/problem+json",
    "application/xml",
  ]) {
    assert.deepEqual(classifyModelInputProcessing(mimeType), {
      kind: MODEL_INPUT_PROCESSING_KIND.DIRECT_TEXT,
      mimeType: String(mimeType).split(";", 1)[0].trim().toLowerCase(),
      modality: null,
    });
  }
  assert.deepEqual(classifyModelInputProcessing("application/pdf"), {
    kind: MODEL_INPUT_PROCESSING_KIND.MULTIMODAL,
    mimeType: "application/pdf",
    modality: "document",
  });
  assert.equal(classifyModelInputProcessing("image/png").modality, "image");
  assert.equal(classifyModelInputProcessing("image/svg+xml").modality, "image");
  assert.equal(classifyModelInputProcessing("audio/wav").modality, "audio");
  assert.equal(classifyModelInputProcessing("video/mp4").modality, "video");
});

test("model library exposes copy-safe provider templates", () => {
  const options = listModelLibraryOptions();
  assert.equal(options.length, 21);
  assert.equal(options[0].key, "gpt_5_6_sol");
  assert.equal(
    options.some((item) => item.key === "gpt_5_4"),
    true,
  );
  assert.deepEqual(
    options
      .filter(({ key }) => resolveModelLibraryProvider(key)?.capabilities?.web_search === true)
      .map(({ key }) => key),
    ["gpt_5_6_sol", "gpt_5_6_terra", "gpt_5_6_luna", "gpt_5_4", "gpt_5_5", "qwen3_7_max"],
  );
  assert.equal(
    options.some((item) => item.key === "gemini_3_7_flash"),
    true,
  );
  assert.equal(
    options.some((item) => item.key === "kimi_k3"),
    true,
  );
  assert.equal(
    options.some((item) => item.key === "glm_5_3"),
    true,
  );
  for (const item of options) {
    assert.equal(Array.isArray(item.reasoning_effort_options), true);
    assert.equal(item.reasoning_effort_options.includes(item.reasoning_effort), true);
    assert.equal(item.reasoning_effort_options.includes(item.tool_reasoning_effort), true);
  }
  assert.equal(resolveModelLibraryProvider("kimi_k3").model, "kimi-k3");
  assert.equal(resolveModelLibraryProvider("kimi_k3").api_key, "${MOONSHOT_API_KEY}");
  assert.deepEqual(resolveModelLibraryProvider("kimi_k3").multimodal_parsing.input_modalities, [
    "image",
    "video",
  ]);
  assert.equal(resolveModelLibraryProvider("glm_5_3").model, "glm-5.3");
  assert.equal(resolveModelLibraryProvider("glm_5_3").reasoning_effort, "low");
  assert.equal(resolveModelLibraryProvider("glm_5_3").multimodal_parsing.enabled, false);
  assert.equal(Object.isFrozen(options[0]), true);

  const first = resolveModelLibraryProvider("gemini_3_7_flash");
  const second = resolveModelLibraryProvider("gemini_3_7_flash");
  first.enabled = false;
  assert.equal(second.enabled, true);
  assert.equal(resolveModelLibraryProvider("missing"), null);
  assert.equal(resolveDefaultModelLibraryProvider().model, "default-model");
});

const invocation = {
  requestId: "r",
  invocationId: "i",
  sessionId: "s",
  parentSessionId: "",
  dialogProcessId: "d",
  turnScopeId: "t",
  runId: "run",
  flow: "agent.main",
  purpose: "main_agent",
  domain: "primary",
  contextSequencePolicy: MODEL_CONTEXT_SEQUENCE_POLICY.CHECKPOINT_APPEND_ONLY,
};
const model = {
  model: "gpt-5",
  operatorId: "openai",
  adapterId: "openai-compatible",
  capabilities: { web_search: true },
};

test("model request has one versioned canonical shape", () => {
  const request = createModelRequest({ invocation, model, messages: [] });
  assert.equal(request.protocolVersion, MODEL_PROTOCOL_VERSION);
  assert.equal(request.model.operatorId, "openai");
  assert.equal(request.model.adapterId, "openai-compatible");
  assert.throws(() => {
    request.model = {};
  }, TypeError);
});

test("model operations are strict discriminated contracts", () => {
  const webSearch = createModelRequest({
    invocation,
    model,
    messages: [],
    operation: { kind: MODEL_OPERATION_KIND.WEB_SEARCH, input: { query: "latest news" } },
  });
  assert.deepEqual(webSearch.operation, {
    kind: MODEL_OPERATION_KIND.WEB_SEARCH,
    input: { query: "latest news" },
    options: {},
  });
  const multimodalParse = createModelRequest({
    invocation,
    model,
    messages: [],
    operation: {
      kind: MODEL_OPERATION_KIND.MULTIMODAL_PARSE,
      input: {
        prompt: "parse",
        attachments: [
          {
            mimeType: "application/pdf",
            data: "data:application/pdf;base64,AA==",
            fileName: "input.pdf",
          },
        ],
      },
    },
  });
  assert.equal(multimodalParse.operation.input.attachments[0].fileName, "input.pdf");
  assert.throws(
    () =>
      createModelRequest({
        invocation,
        model,
        messages: [],
        operation: {
          kind: MODEL_OPERATION_KIND.MULTIMODAL_PARSE,
          input: {
            prompt: "parse",
            attachments: [
              {
                mimeType: "text/plain",
                data: "data:text/plain;base64,AA==",
                fileName: "tool-result.txt",
              },
            ],
          },
        },
      }),
    /directly readable text/,
  );
  assert.throws(
    () =>
      createModelRequest({
        invocation,
        model,
        messages: [],
        operation: {
          kind: MODEL_OPERATION_KIND.MULTIMODAL_PARSE,
          input: {
            prompt: "parse",
            attachment: {
              mimeType: "application/pdf",
              data: "data:application/pdf;base64,AA==",
            },
          },
        },
      }),
    /unsupported fields: attachment/,
  );
  assert.throws(
    () =>
      createModelRequest({
        invocation,
        model,
        messages: [],
        operation: { kind: "web_search", input: {} },
      }),
    /input\.query is required/,
  );
  assert.throws(
    () =>
      createModelRequest({
        invocation,
        model,
        messages: [],
        operation: {
          kind: "image_generation",
          input: { prompt: "draw" },
          options: { apiType: "legacy" },
        },
      }),
    /unsupported image generation api type/,
  );
  assert.throws(
    () =>
      createModelRequest({
        invocation,
        model,
        messages: [],
        operation: { kind: "chat", input: { legacy: true } },
      }),
    /unsupported fields: legacy/,
  );
});

test("model operation results are validated by operation kind", () => {
  const output = { text: "ok", reasoning: "", toolCalls: [], finishReason: "stop", usage: {} };
  const response = createModelResponse({
    invocation,
    operationKind: MODEL_OPERATION_KIND.WEB_SEARCH,
    output,
    result: { rawText: "answer", output: [{ type: "message" }] },
    attempts: [{ attempt: 1, status: "completed", kind: "web_search", streaming: false, output }],
    model,
    provider: { operatorId: "openai", adapterId: "openai-compatible", format: "openai_compatible" },
  });
  assert.equal(validateModelResponse(response), response);
  assert.throws(
    () =>
      createModelResponse({
        invocation,
        operationKind: MODEL_OPERATION_KIND.WEB_SEARCH,
        output,
        result: { imageArtifacts: [] },
        attempts: [
          { attempt: 1, status: "completed", kind: "web_search", streaming: false, output },
        ],
        model,
      }),
    /unsupported fields: imageArtifacts/,
  );
});

test("model response accepts only the canonical protocol shape", () => {
  const output = { text: "ok", reasoning: "", toolCalls: [], finishReason: "stop", usage: {} };
  const response = createModelResponse({
    invocation,
    output,
    attempts: [{ attempt: 1, status: "completed", kind: "response", streaming: false, output }],
    model,
    provider: { operatorId: "openai", adapterId: "openai-compatible", format: "openai_compatible" },
  });
  assert.equal(validateModelResponse(response), response);
  assert.throws(
    () => validateModelResponse({ ...response, content: "legacy" }),
    /unsupported fields: content/,
  );
  assert.throws(
    () => validateModelResponse({ ...response, output: { text: "ok" } }),
    /reasoning must be a string/,
  );
});

test("model request requires one explicit context sequence policy", () => {
  assert.throws(
    () =>
      createModelRequest({
        invocation: { ...invocation, contextSequencePolicy: "" },
        model,
        messages: [],
      }),
    /invalid model context sequence policy: missing/,
  );
  assert.equal(
    createModelRequest({ invocation, model, messages: [] }).invocation.contextSequencePolicy,
    MODEL_CONTEXT_SEQUENCE_POLICY.CHECKPOINT_APPEND_ONLY,
  );
});

test("model request derives provider and adapter identities", () => {
  // The transport is a protocol constant carried by adapterId, so a spec that
  // still names a format is a non-converged producer rather than a valid input.
  assert.throws(
    () =>
      createModelRequest({
        invocation,
        model: { ...model, format: "openai_compatible" },
        messages: [],
      }),
    /format is not part of this protocol/,
  );
  const derived = createModelRequest({
    invocation,
    model: { ...model, operatorId: "openai", adapterId: "ignored" },
    messages: [],
  });
  assert.equal(derived.model.operatorId, "openai");
  assert.equal(derived.model.adapterId, "openai-compatible");
});

test("multimodal capabilities are governed only by explicit model configuration", () => {
  const configured = {
    model: "arbitrary-model-name",
    multimodal_parsing: {
      enabled: true,
      input_modalities: ["IMAGE", "document", "unsupported", "image"],
    },
    multimodal_generation: {
      support_generation: {
        enabled: true,
        support_scope: ["image"],
        api_type: "openai_responses",
      },
    },
  };
  assert.deepEqual(resolveModelMultimodalCapabilities(configured), {
    parsing: { enabled: true, inputModalities: ["image", "document"] },
    generation: {
      enabled: true,
      outputModalities: ["image"],
      apiType: "openai_responses",
    },
  });
  assert.equal(supportsModelMultimodalParsing(configured, ["image", "document"]), true);
  assert.equal(supportsModelMultimodalParsing(configured, ["audio"]), false);
  assert.equal(supportsModelMultimodalGeneration(configured, ["image"]), true);
  assert.equal(supportsModelMultimodalGeneration(configured, ["video"]), false);

  const suggestiveNameOnly = { model: "omni-vision-image-video" };
  assert.equal(supportsModelMultimodalParsing(suggestiveNameOnly, ["image"]), false);
  assert.equal(supportsModelMultimodalGeneration(suggestiveNameOnly, ["image"]), false);
});

test("model operation capabilities are governed only by explicit model configuration", () => {
  const configured = {
    capabilities: {
      streaming: false,
      tools: true,
      web_search: true,
      image_generation: false,
    },
  };
  assert.deepEqual(normalizeModelCapabilities(configured.capabilities), {
    streaming: false,
    tools: true,
    vision: false,
    reasoning: false,
    web_search: true,
    image_generation: false,
  });
  assert.equal(supportsModelCapability(configured, "web_search"), true);
  assert.equal(supportsModelCapability({}, "web_search"), false);
  assert.throws(
    () => supportsModelCapability(configured, "unknown"),
    /unsupported model capability/,
  );
  assert.throws(
    () =>
      createModelRequest({
        invocation,
        model: { ...model, capabilities: {} },
        messages: [],
        operation: { kind: MODEL_OPERATION_KIND.WEB_SEARCH, input: { query: "latest" } },
      }),
    /does not declare web_search capability/,
  );
});

test("reasoning transport is declared by the provider, never inferred from a model name", () => {
  // A model name that looks like Gemini must not select Gemini's parameter.
  const misleading = {
    model: "gemini-3.7-flash",
    reasoning_effort_parameter: "reasoning_effort",
    reasoning_effort_options: ["low", "high"],
    reasoning_effort: "high",
  };
  assert.deepEqual(buildModelReasoningEffortTransport(misleading, "high"), {
    reasoning_effort: "high",
  });
  const declared = {
    model: "in-house-model",
    reasoning_effort_parameter: "thinking_level",
    reasoning_effort_options: ["low", "medium"],
  };
  assert.deepEqual(buildModelReasoningEffortTransport(declared, "medium"), {
    thinking_level: "medium",
  });
});

test("a switch-shaped reasoning parameter carries a boolean on the wire", () => {
  const provider = {
    reasoning_effort_parameter: "enable_thinking",
    reasoning_effort_options: ["none", "medium"],
  };
  assert.deepEqual(buildModelReasoningEffortTransport(provider, "medium"), {
    enable_thinking: true,
  });
  assert.deepEqual(buildModelReasoningEffortTransport(provider, "none"), {
    enable_thinking: false,
  });
});

test("reasoning declarations are validated rather than silently defaulted", () => {
  assert.throws(
    () => normalizeModelReasoningConfiguration({ reasoning_effort_parameter: "reasoning_effort" }),
    /reasoning_effort_options is required/,
  );
  assert.throws(
    () => normalizeModelReasoningConfiguration({ reasoning_effort_options: ["low"] }),
    /reasoning_effort_parameter/,
  );
  assert.throws(
    () =>
      normalizeModelReasoningConfiguration({
        reasoning_effort_options: ["low"],
        reasoning_effort_parameter: "thinking_budget",
      }),
    /unsupported model provider reasoning_effort_parameter/,
  );
});

test("an effort outside the declared options resolves to the lowest declared level", () => {
  const normalized = normalizeModelReasoningConfiguration({
    reasoning_effort_parameter: "reasoning_effort",
    reasoning_effort_options: ["high", "max"],
    reasoning_effort: "medium",
    tool_reasoning_effort: "invalid",
  });
  assert.equal(normalized.reasoning_effort, "high");
  assert.equal(normalized.tool_reasoning_effort, "high");
  assert.equal(resolveModelMinimumReasoningEffort(normalized), "high");
});

test("every library provider declares a canonical reasoning contract", () => {
  for (const option of listModelLibraryOptions()) {
    const provider = resolveModelLibraryProvider(option.key);
    assert.deepEqual(
      normalizeModelReasoningConfiguration(provider),
      {
        reasoning_effort_parameter: provider.reasoning_effort_parameter,
        reasoning_effort_options: provider.reasoning_effort_options,
        reasoning_effort: provider.reasoning_effort,
        tool_reasoning_effort: provider.tool_reasoning_effort,
      },
      `${option.key} declares a non-canonical reasoning contract`,
    );
  }
});
