/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
  MODEL_CONTEXT_SEQUENCE_POLICY,
  MODEL_MULTIMODAL_MODALITY,
  MODEL_OPERATION_KIND,
  supportsModelMultimodalGeneration,
} from "@noobot/model-protocol";
import {
  MULTIMODAL_CONFIG_MODALITY,
  MULTIMODAL_CONFIG_OPERATION,
  mergeConfig,
  resolveMultimodalDefaultModelSelection,
} from "../../config/index.js";
import { resolveModelSpecOrConfiguredDefault } from "../../models/index.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";
import { recoverableToolError } from "../../shared/errors/index.js";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import { MIME_TYPE } from "@noobot/attachment-protocol/mime";
import { TOOL_CALL_MODE, TOOL_NAME, TOOL_RESULT_STATUS } from "../constants/index.js";

const MULTIMODAL_FLOW_NAME = "agent.multimodal_generate";
const MULTIMODAL_PURPOSE_NAME = "multimodal_generate";
const MULTIMODAL_DOMAIN_NAME = "tool";
function tMultimodal(runtime = {}, key = "", params = {}) {
  return tTool(runtime, `tools.multimodal.${String(key || "").trim()}`, params);
}

function resolveModelBaseUrl(modelSpec = {}) {
  return String(modelSpec.base_url || "").trim();
}

function describeBaseUrlForDiagnostics(baseUrl = "") {
  const value = String(baseUrl || "").trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return value.replace(/[?#].*$/, "").replace(/\/+$/, "");
  }
}

function resolveGenerateErrorCode(error = {}) {
  const errorCode = String(error?.code || "").trim();
  if (errorCode && errorCode !== "undefined") return errorCode;
  return ERROR_CODE.RECOVERABLE_MULTIMODAL_GENERATE_FAILED;
}

function maskDiagnosticUrl(value = "") {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  try {
    const url = new URL(normalized);
    if (url.username) url.username = "***";
    if (url.password) url.password = "***";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return normalized.replace(/:\/\/([^:@/]+):([^@/]+)@/, "://***:***@").replace(/[?#].*$/, "");
  }
}

function collectProxyEnvDiagnostics(env = process.env) {
  const keys = [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
  ];
  return Object.fromEntries(
    keys.map((key) => [key, maskDiagnosticUrl(env?.[key])]).filter(([, value]) => Boolean(value)),
  );
}

function buildFailureDetails({
  message = "",
  modelAlias = "",
  model = "",
  requestedModel = "",
  effectiveImageSize = "",
  modelSpec = {},
  requestUrl = "",
  requestMethod = "",
} = {}) {
  return {
    ...(message ? { message } : {}),
    modelAlias,
    model,
    ...(String(requestedModel || "").trim()
      ? { requestedModel: String(requestedModel).trim() }
      : {}),
    callMode: TOOL_CALL_MODE.MULTIMODAL_GENERATION,
    baseUrl: describeBaseUrlForDiagnostics(resolveModelBaseUrl(modelSpec || {})),
    requestUrl: describeBaseUrlForDiagnostics(requestUrl),
    requestMethod: String(requestMethod || "")
      .trim()
      .toUpperCase(),
    imageSize: String(effectiveImageSize || "").trim(),
    platform: process.platform,
    proxyEnv: collectProxyEnvDiagnostics(),
  };
}

async function imageUrlToBase64(url = "", fetchImpl = null, runtime = {}) {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl || typeof fetchImpl !== "function") return "";
  const response = await fetchImpl(normalizedUrl);
  if (!response?.ok) {
    throw recoverableToolError(
      `${tMultimodal(runtime, "fetchGeneratedImageUrlFailed")}: HTTP ${response?.status || 500}`,
      { code: ERROR_CODE.RECOVERABLE_FETCH_GENERATED_IMAGE_URL_FAILED },
    );
  }
  const imageBytes = Buffer.from(await response.arrayBuffer());
  return imageBytes.toString("base64");
}

function normalizeStringArray(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function shouldAppendCapabilityHint(error = {}) {
  if (error?.capabilityUnavailable === true) return true;
  if (error?.code) {
    return String(error.code || "") === ERROR_CODE.RECOVERABLE_MULTIMODAL_GENERATE_FAILED;
  }
  return Boolean(error?.status || error?.statusCode || error?.payload);
}

function appendCapabilityHint(message = "", runtime = {}) {
  const baseMessage = String(message || "").trim() || tMultimodal(runtime, "generateFailed");
  const hint = tMultimodal(runtime, "capabilityUnavailable");
  return hint ? `${baseMessage}\n${hint}` : baseMessage;
}

function resolveGenerationModelSpec({
  modelName = "",
  effectiveConfig = {},
  globalConfig = {},
  userConfig = {},
}) {
  const preferredModelName = String(modelName || "").trim();
  const configuredDefault = preferredModelName
    ? ""
    : resolveMultimodalDefaultModelSelection(effectiveConfig, {
        operation: MULTIMODAL_CONFIG_OPERATION.GENERATION,
        modalities: [MULTIMODAL_CONFIG_MODALITY.IMAGE],
      }).alias;
  const resolvedModelName = preferredModelName || configuredDefault;
  if (!resolvedModelName) return { resolvedModelName: "", resolvedModelSpec: null };
  const resolvedModelSpec = resolveModelSpecOrConfiguredDefault({
    modelName: resolvedModelName,
    globalConfig,
    userConfig,
  });
  return {
    resolvedModelName,
    resolvedModelSpec,
  };
}

function trimmedText(value) {
  return String(value || "").trim();
}

function assertGenerationModelSupported(state, runtime) {
  const { resolvedModelSpec, resolvedModelName } = state;
  if (!resolvedModelSpec) {
    throw recoverableToolError(
      tMultimodal(runtime, "modelNotFound", { model: resolvedModelName }),
      {
        code: ERROR_CODE.RECOVERABLE_MODEL_NOT_FOUND,
        details: { requestedModel: trimmedText(resolvedModelName) },
      },
    );
  }
  if (supportsModelMultimodalGeneration(resolvedModelSpec, [MODEL_MULTIMODAL_MODALITY.IMAGE])) {
    return;
  }
  const currentModelAlias = trimmedText(resolvedModelSpec.alias || resolvedModelName);
  const currentModelName = trimmedText(resolvedModelSpec.model);
  throw recoverableToolError(
    tMultimodal(runtime, "multimodalUnsupportedError", {
      model: currentModelAlias || currentModelName || "unknown_model",
    }),
    {
      code: ERROR_CODE.RECOVERABLE_MODEL_MULTIMODAL_GENERATION_UNSUPPORTED,
      details: {
        message: tMultimodal(runtime, "multimodalUnsupportedMessage"),
        modelAlias: currentModelAlias,
        model: currentModelName,
      },
    },
  );
}

function buildImageGenerationRequest({ modelSpec, generationContent, imageSize, input, runtime }) {
  return {
    model: modelSpec,
    messages: [],
    operation: {
      kind: MODEL_OPERATION_KIND.IMAGE_GENERATION,
      input: { prompt: generationContent },
      options: {
        size: imageSize,
        resolution: input.resolution,
        n: input.n,
        quality: input.quality,
        imageUrls: normalizeStringArray(input.image_urls),
      },
    },
    options: {
      signal: runtime?.abortSignal || undefined,
      locale: runtime?.systemRuntime?.config?.locale || runtime?.locale || "zh-CN",
    },
    invocation: {
      flow: MULTIMODAL_FLOW_NAME,
      purpose: MULTIMODAL_PURPOSE_NAME,
      domain: MULTIMODAL_DOMAIN_NAME,
      contextSequencePolicy: MODEL_CONTEXT_SEQUENCE_POLICY.INDEPENDENT_REQUEST,
    },
  };
}

async function materializeImageAttachments(imageArtifacts, fetchImpl, runtime) {
  const outputArtifacts = [];
  for (const imageArtifact of imageArtifacts) {
    const resolvedBase64 =
      imageArtifact.b64Json || (await imageUrlToBase64(imageArtifact.url, fetchImpl, runtime));
    if (!resolvedBase64) continue;
    outputArtifacts.push({
      type: "attachment_bytes",
      name: imageArtifact.fileName,
      mimeType: MIME_TYPE.IMAGE_PNG,
      contentBase64: resolvedBase64,
    });
  }
  return outputArtifacts;
}

function stateFailureDetails(state, error = {}, message = "") {
  return buildFailureDetails({
    message,
    modelAlias: trimmedText(state.resolvedModelSpec?.alias),
    model: trimmedText(state.resolvedModelSpec?.model),
    requestedModel: state.resolvedModelName,
    effectiveImageSize: state.effectiveImageSize,
    modelSpec: state.resolvedModelSpec || {},
    requestUrl: error?.requestUrl,
    requestMethod: error?.requestMethod,
  });
}

function toGenerationFailure(error, state, runtime) {
  const errorStatusCode = Number(error?.status || error?.statusCode || 0);
  const errorMessage = String(error?.message || String(error || "")).trim();
  if (errorStatusCode === 403 && errorMessage.toLowerCase().includes("images api is not enabled")) {
    const hintMessage = appendCapabilityHint(
      tMultimodal(runtime, "imagesApiNotEnabledError"),
      runtime,
    );
    return recoverableToolError(hintMessage, {
      code: ERROR_CODE.RECOVERABLE_IMAGES_API_NOT_ENABLED,
      details: stateFailureDetails(state, error, hintMessage),
    });
  }
  const baseMessage = errorMessage || tMultimodal(runtime, "generateFailed");
  if (!shouldAppendCapabilityHint(error)) {
    return recoverableToolError(baseMessage, {
      code: resolveGenerateErrorCode(error),
      details: stateFailureDetails(state, error),
    });
  }
  const hintMessage = appendCapabilityHint(baseMessage, runtime);
  return recoverableToolError(hintMessage, {
    code: resolveGenerateErrorCode(error),
    details: stateFailureDetails(state, error, hintMessage),
  });
}

async function generateImages(input, deps, state) {
  const { runtime } = deps;
  const selection = resolveGenerationModelSpec({
    modelName: input.model_name,
    effectiveConfig: deps.effectiveConfig,
    globalConfig: deps.globalConfig,
    userConfig: deps.userConfig,
  });
  state.resolvedModelName = selection.resolvedModelName;
  state.resolvedModelSpec = selection.resolvedModelSpec;
  assertGenerationModelSupported(state, runtime);
  state.effectiveImageSize = trimmedText(input.size || input.image_size);
  const modelPort = runtime?.modelPort;
  if (!modelPort || typeof modelPort.invoke !== "function") {
    throw new TypeError("multimodal generation requires runtime.modelPort");
  }
  const response = await modelPort.invoke(
    buildImageGenerationRequest({
      modelSpec: state.resolvedModelSpec,
      generationContent: state.generationContent,
      imageSize: state.effectiveImageSize,
      input,
      runtime,
    }),
  );
  const generationResult = response.result;
  const imageArtifacts = Array.isArray(generationResult?.imageArtifacts)
    ? generationResult.imageArtifacts
    : [];
  if (!imageArtifacts.length) {
    throw recoverableToolError(tMultimodal(runtime, "generateFailed"), {
      code: ERROR_CODE.RECOVERABLE_MULTIMODAL_GENERATE_FAILED,
      details: stateFailureDetails(
        state,
        {},
        "Image generation completed without an image_generation_call result",
      ),
    });
  }
  const outputArtifacts = await materializeImageAttachments(
    imageArtifacts,
    deps.sharedFetch,
    runtime,
  );
  return toToolJsonResult(
    TOOL_NAME.MULTIMODAL_GENERATE,
    {
      ok: true,
      status: TOOL_RESULT_STATUS.COMPLETED,
      callMode: TOOL_CALL_MODE.MULTIMODAL_GENERATION,
      modelAlias: trimmedText(state.resolvedModelSpec?.alias),
      model: trimmedText(state.resolvedModelSpec?.model),
      text: trimmedText(generationResult?.rawText),
      generationContentSource: "tool_input_generation_content",
      outputArtifacts,
      summary: {
        task_id: trimmedText(generationResult?.taskId),
        generated_image_count: imageArtifacts.length,
        saved_attachment_count: outputArtifacts.length,
      },
    },
    true,
  );
}

async function runMultimodalGeneration(rawInput = {}, deps = {}) {
  const input = {
    model_name: "",
    image_size: "",
    size: "",
    resolution: "",
    n: 1,
    quality: "",
    image_urls: [],
  };
  for (const [key, value] of Object.entries(rawInput || {})) {
    if (value !== undefined) input[key] = value;
  }
  const state = {
    generationContent: trimmedText(input.generation_content),
    resolvedModelSpec: null,
    resolvedModelName: "",
    effectiveImageSize: "",
  };
  if (!state.generationContent) {
    throw recoverableToolError(tMultimodal(deps.runtime, "generationContentRequired"), {
      code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
    });
  }
  try {
    return await generateImages(input, deps, state);
  } catch (error) {
    throw toGenerationFailure(error, state, deps.runtime);
  }
}

export function createMultimodalGenerateTool({ agentContext }) {
  const runtime = agentContext?.bindings?.runtime || {};
  const effectiveConfig = mergeConfig(runtime?.globalConfig || {}, runtime?.userConfig || {});
  const toolEnabled = effectiveConfig?.tools?.[TOOL_NAME.MULTIMODAL_GENERATE]?.enabled !== false;
  if (!toolEnabled) return [];

  const globalConfig = runtime?.globalConfig || {};
  const userConfig = runtime?.userConfig || {};
  const sharedFetch =
    typeof runtime?.sharedTools?.fetch === "function"
      ? runtime.sharedTools.fetch
      : typeof globalThis.fetch === "function"
        ? globalThis.fetch.bind(globalThis)
        : null;

  const multimodalGenerateTool = new DynamicStructuredTool({
    name: TOOL_NAME.MULTIMODAL_GENERATE,
    description: tTool(runtime, "tools.multimodal.description"),
    schema: z.object({
      generation_content: z
        .string()
        .describe(tTool(runtime, "tools.multimodal.fieldGenerationContent")),
      model_name: z.string().optional().describe(tTool(runtime, "tools.multimodal.fieldModelName")),
      size: z.string().optional().describe(tTool(runtime, "tools.multimodal.fieldSize")),
      image_size: z.string().optional().describe(tTool(runtime, "tools.multimodal.fieldImageSize")),
      resolution: z
        .string()
        .optional()
        .describe(tTool(runtime, "tools.multimodal.fieldResolution")),
      n: z.number().optional().describe(tTool(runtime, "tools.multimodal.fieldN")),
      quality: z.string().optional().describe(tTool(runtime, "tools.multimodal.fieldQuality")),
      image_urls: z
        .array(z.string())
        .optional()
        .describe(tTool(runtime, "tools.multimodal.fieldImageUrls")),
    }),
    func: async (input) =>
      runMultimodalGeneration(input, {
        runtime,
        effectiveConfig,
        globalConfig,
        userConfig,
        sharedFetch,
      }),
  });

  return [multimodalGenerateTool];
}
