/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { structuredTool } from "../core/structured-tool.js";
import { z } from "zod";
import {
  MODEL_CONTEXT_SEQUENCE_POLICY,
  MODEL_GENERATION_OUTPUT_TYPES,
  MODEL_GENERATION_OPTION_FIELDS,
} from "@noobot/model-protocol";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { diagnoseModelReference } from "@noobot/agent-config-protocol";
import {
  MULTIMODAL_CONFIG_OPERATION,
  mergeConfig,
  resolveMultimodalDefaultModelSelection,
} from "../../config/index.js";
import { resolveModelSpecOrConfiguredDefault } from "../../models/index.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";
import { resolveLocaleFromRuntime } from "noobot-i18n/shared";
import { requireRuntimeModelHost } from "../../runtime/model-port-host.js";
import { recoverableToolError } from "../../shared/errors/index.js";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import { buildGenerationOperation } from "./generation-operation.js";
import { materializeGenerationAttachments } from "./generation-artifacts.js";
import { TOOL_CALL_MODE, TOOL_NAME } from "../constants/index.js";
import { text } from "@noobot/shared/value";

const MULTIMODAL_FLOW_NAME = "agent.multimodal_generate";
const MULTIMODAL_PURPOSE_NAME = "multimodal_generate";
const MULTIMODAL_DOMAIN_NAME = "tool";
function tMultimodal(runtime = {}, key = "", params = {}) {
  return tTool(runtime, `tools.multimodal.${text(key)}`, params);
}

function resolveModelBaseUrl(modelSpec = {}) {
  return text(modelSpec.base_url);
}

function describeBaseUrlForDiagnostics(baseUrl = "") {
  const value = text(baseUrl);
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
  const errorCode = text(error?.code);
  if (errorCode && errorCode !== "undefined") return errorCode;
  return ERROR_CODE.RECOVERABLE_MULTIMODAL_GENERATE_FAILED;
}

function maskDiagnosticUrl(value = "") {
  const normalized = text(value);
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
  effectiveSize = "",
  modelSpec = {},
  requestUrl = "",
  requestMethod = "",
  taskId = "",
  outputType = "",
} = {}) {
  return {
    ...(message ? { message } : {}),
    modelAlias,
    model,
    ...(text(requestedModel) ? { requestedModel: String(requestedModel).trim() } : {}),
    callMode: TOOL_CALL_MODE.MULTIMODAL_GENERATION,
    baseUrl: describeBaseUrlForDiagnostics(resolveModelBaseUrl(modelSpec || {})),
    requestUrl: describeBaseUrlForDiagnostics(requestUrl),
    requestMethod: text(requestMethod).toUpperCase(),
    taskId: text(taskId),
    outputType,
    size: text(effectiveSize),
    platform: process.platform,
    proxyEnv: collectProxyEnvDiagnostics(),
  };
}

function shouldAppendCapabilityHint(error = {}) {
  if (error?.capabilityUnavailable === true) return true;
  if (error?.code) {
    return String(error.code || "") === ERROR_CODE.RECOVERABLE_MULTIMODAL_GENERATE_FAILED;
  }
  return Boolean(error?.status || error?.statusCode || error?.payload);
}

function appendCapabilityHint(message = "", runtime = {}) {
  const baseMessage = text(message) || tMultimodal(runtime, "generateFailed");
  const hint = tMultimodal(runtime, "capabilityUnavailable");
  return hint ? `${baseMessage}\n${hint}` : baseMessage;
}

function resolveGenerationModelSpec({
  modelName = "",
  modality = "image",
  effectiveConfig = {},
  globalConfig = {},
  userConfig = {},
}) {
  const preferredModelName = text(modelName);
  const configuredDefault = preferredModelName
    ? ""
    : resolveMultimodalDefaultModelSelection(effectiveConfig, {
        operation: MULTIMODAL_CONFIG_OPERATION.GENERATION,
        modalities: [modality],
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
  return text(value);
}

function assertGenerationModelSupported(state, runtime) {
  const { resolvedModelSpec, resolvedModelName } = state;
  const issue = diagnoseModelReference({
    provider: resolvedModelSpec,
    alias: resolvedModelName,
    requirement: `generate:${state.modality}`,
    path: state.modelReferencePath,
  });
  if (!resolvedModelSpec) {
    throw recoverableToolError(
      tMultimodal(runtime, "modelNotFound", { model: resolvedModelName }),
      {
        code: ERROR_CODE.RECOVERABLE_MODEL_NOT_FOUND,
        details: { requestedModel: trimmedText(resolvedModelName), configIssues: [issue] },
      },
    );
  }
  if (!issue) {
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
        configIssues: [issue],
      },
    },
  );
}

function buildMediaGenerationRequest({
  modelSpec,
  generationContent,
  input,
  runtime,
  abortSignal,
}) {
  const operation = buildGenerationOperation({ input, prompt: generationContent });
  return {
    model: modelSpec,
    messages: [],
    operation,
    options: {
      signal: abortSignal,
      locale: resolveLocaleFromRuntime(runtime),
    },
    invocation: {
      flow: MULTIMODAL_FLOW_NAME,
      purpose: MULTIMODAL_PURPOSE_NAME,
      domain: MULTIMODAL_DOMAIN_NAME,
      contextSequencePolicy: MODEL_CONTEXT_SEQUENCE_POLICY.INDEPENDENT_REQUEST,
    },
  };
}

function stateFailureDetails(state, error = {}, message = "") {
  return buildFailureDetails({
    message,
    modelAlias: trimmedText(state.resolvedModelSpec?.alias),
    model: trimmedText(state.resolvedModelSpec?.model),
    requestedModel: state.resolvedModelName,
    effectiveSize: state.effectiveSize,
    modelSpec: state.resolvedModelSpec || {},
    requestUrl: error?.requestUrl,
    requestMethod: error?.requestMethod,
    taskId: error?.taskId,
    outputType: state.modality,
  });
}

function toGenerationFailure(error, state, runtime) {
  const errorStatusCode = Number(error?.status || error?.statusCode || 0);
  const errorMessage = text(error?.message) || String(error || "");
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

async function generateMedia(input, deps, state) {
  const { runtime } = deps;
  const timeout = AbortSignal.timeout(TIME_THRESHOLDS.model.generationTimeoutMs);
  const abortSignal = deps.abortSignal ? AbortSignal.any([deps.abortSignal, timeout]) : timeout;
  const selection = resolveGenerationModelSpec({
    modelName: input.model_name,
    modality: state.modality,
    effectiveConfig: deps.effectiveConfig,
    globalConfig: deps.globalConfig,
    userConfig: deps.userConfig,
  });
  state.resolvedModelName = selection.resolvedModelName;
  state.resolvedModelSpec = selection.resolvedModelSpec;
  state.modelReferencePath = text(input.model_name)
    ? ["model_name"]
    : ["multimodal", "generation", "default_models", state.modality];
  assertGenerationModelSupported(state, runtime);
  state.effectiveSize = trimmedText(input.size);
  const { modelPort } = requireRuntimeModelHost(runtime);
  const response = await modelPort.invoke(
    buildMediaGenerationRequest({
      modelSpec: state.resolvedModelSpec,
      generationContent: state.generationContent,
      input,
      runtime,
      abortSignal,
    }),
  );
  const generationResult = response.result;
  const mediaArtifacts = generationResult.artifacts;
  if (!Array.isArray(mediaArtifacts) || !mediaArtifacts.length) {
    throw recoverableToolError(tMultimodal(runtime, "generateFailed"), {
      code: ERROR_CODE.RECOVERABLE_MULTIMODAL_GENERATE_FAILED,
      details: stateFailureDetails(
        state,
        {},
        `Native ${state.modality} generation returned no media`,
      ),
    });
  }
  const outputArtifacts = await materializeGenerationAttachments(mediaArtifacts, {
    modality: state.modality,
    fetchImpl: deps.sharedFetch,
    abortSignal,
  });
  return toToolJsonResult(
    TOOL_NAME.MULTIMODAL_GENERATE,
    {
      ok: true,
      callMode: TOOL_CALL_MODE.MULTIMODAL_GENERATION,
      modelAlias: trimmedText(state.resolvedModelSpec?.alias),
      model: trimmedText(state.resolvedModelSpec?.model),
      text: trimmedText(generationResult?.rawText),
      generationContentSource: "tool_input_generation_content",
      outputArtifacts,
      summary: {
        task_id: trimmedText(generationResult?.taskId),
        [`generated_${state.modality}_count`]: mediaArtifacts.length,
        saved_attachment_count: outputArtifacts.length,
      },
    },
    true,
  );
}

async function runMultimodalGeneration(input, deps) {
  const state = {
    generationContent: trimmedText(input.generation_content),
    modality: input.output_type,
    resolvedModelSpec: null,
    resolvedModelName: "",
    effectiveSize: "",
  };
  if (!state.generationContent) {
    throw recoverableToolError(tMultimodal(deps.runtime, "generationContentRequired"), {
      code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
    });
  }
  try {
    return await generateMedia(input, deps, state);
  } catch (error) {
    throw toGenerationFailure(error, state, deps.runtime);
  }
}

function generationSchema(runtime) {
  const fields = {
    duration: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(tTool(runtime, "tools.multimodal.fieldDuration")),
    aspect_ratio: z
      .string()
      .optional()
      .describe(tTool(runtime, "tools.multimodal.fieldAspectRatio")),
    complexity: z
      .enum(["low", "medium", "high"])
      .optional()
      .describe(tTool(runtime, "tools.multimodal.fieldComplexity")),
    size: z.string().optional().describe(tTool(runtime, "tools.multimodal.fieldSize")),
    resolution: z.string().optional().describe(tTool(runtime, "tools.multimodal.fieldResolution")),
    n: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe(tTool(runtime, "tools.multimodal.fieldN")),
    quality: z.string().optional().describe(tTool(runtime, "tools.multimodal.fieldQuality")),
    image_urls: z
      .array(z.string())
      .optional()
      .describe(tTool(runtime, "tools.multimodal.fieldImageUrls")),
  };
  return z.discriminatedUnion(
    "output_type",
    MODEL_GENERATION_OUTPUT_TYPES.map((outputType) => {
      const output = z
        .literal(outputType)
        .describe(tTool(runtime, "tools.multimodal.fieldOutputType"));
      return z
        .strictObject({
          output_type: outputType === "image" ? output.default("image") : output,
          generation_content: z
            .string()
            .describe(tTool(runtime, "tools.multimodal.fieldGenerationContent")),
          model_name: z
            .string()
            .optional()
            .describe(tTool(runtime, "tools.multimodal.fieldModelName")),
          ...Object.fromEntries(
            Object.keys(MODEL_GENERATION_OPTION_FIELDS[outputType]).map((key) => [
              key,
              fields[key],
            ]),
          ),
        })
        .superRefine((input, context) => {
          try {
            buildGenerationOperation({ input, prompt: input.generation_content });
          } catch (error) {
            context.addIssue({ code: "custom", message: error.message });
          }
        });
    }),
  );
}

export function createMultimodalGenerateTool({ agentContext }) {
  const runtime = agentContext?.bindings?.runtime || {};
  const effectiveConfig = mergeConfig(runtime?.globalConfig || {}, runtime?.userConfig || {});
  const toolEnabled = effectiveConfig?.tools?.[TOOL_NAME.MULTIMODAL_GENERATE]?.enabled !== false;
  if (!toolEnabled) return [];

  const globalConfig = runtime?.globalConfig || {};
  const userConfig = runtime?.userConfig || {};
  const sharedFetch = runtime.sharedTools.fetch;

  const multimodalGenerateTool = structuredTool(
    runtime,
    (input, toolConfig) =>
      runMultimodalGeneration(input, {
        runtime,
        effectiveConfig,
        globalConfig,
        userConfig,
        sharedFetch,
        abortSignal: toolConfig.signal,
      }),
    {
      name: TOOL_NAME.MULTIMODAL_GENERATE,
      description: tTool(runtime, "tools.multimodal.description"),
      schema: generationSchema(runtime),
    },
    agentContext,
  );

  return [multimodalGenerateTool];
}
