/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import OpenAI from "openai";
import { z } from "zod";
import { mergeConfig } from "../../config/index.js";
import { mapAttachmentRecordsToMetas } from "../../attach/meta-ops.js";
import {
  resolveDefaultModelSpec,
  resolveModelSpecByName,
} from "../../model/index.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";
import { parseDataUrl, sanitizeGeneratedArtifactName } from "../../utils/mime-utils.js";
import { generateWithImagesAsyncApi } from "./images-async-adapter.js";
import { recoverableToolError } from "../../error/index.js";
import { ERROR_CODE } from "../../error/constants.js";
import { MIME_TYPE } from "../../constants/index.js";
import { resolveParentSessionId } from "../../context/parent-session-id-resolver.js";
import {
  buildPluginModelHeaders,
  MODEL_NAME_HEADER_KEY,
  PARENT_SESSION_HEADER_KEY,
} from "../../model/headers/plugin-headers.js";
import {
  ARTIFACT_GENERATION_SOURCE,
  TOOL_ATTACHMENT_SOURCE,
  TOOL_CALL_MODE,
  IMAGE_GENERATION_API_TYPE,
  TOOL_NAME,
  TOOL_RESULT_STATUS,
} from "../constants/index.js";

const MULTIMODAL_FLOW_NAME = "agent.multimodal_generate";
const MULTIMODAL_PURPOSE_NAME = "multimodal_generate";
const MULTIMODAL_DOMAIN_NAME = "tool";
const AVAILABLE_GENERATION_API_TYPES = Object.freeze([
  IMAGE_GENERATION_API_TYPE.OPENAI_RESPONSES,
  IMAGE_GENERATION_API_TYPE.IMAGES_ASYNC,
]);
const GENERATION_API_TYPE_ALIASES = Object.freeze({
  [IMAGE_GENERATION_API_TYPE.OPENAI_RESPONSES]: [
    "responses",
    "responses_api",
    "openai_responses_api",
  ],
  [IMAGE_GENERATION_API_TYPE.IMAGES_ASYNC]: [
    "image_async",
    "images_generations",
    "images",
  ],
});

function tMultimodal(runtime = {}, key = "", params = {}) {
  return tTool(runtime, `tools.multimodal.${String(key || "").trim()}`, params);
}

function resolveModelApiKey(modelSpec = {}) {
  return String(modelSpec?.api_key || "").trim();
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

function generationApiTypeToCallMode(apiType = "") {
  return apiType === IMAGE_GENERATION_API_TYPE.IMAGES_ASYNC
    ? TOOL_CALL_MODE.IMAGES_ASYNC_API
    : TOOL_CALL_MODE.OPENAI_RESPONSES_API;
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
    keys
      .map((key) => [key, maskDiagnosticUrl(env?.[key])])
      .filter(([, value]) => Boolean(value)),
  );
}

function buildFailureDetails({
  message = "",
  modelAlias = "",
  model = "",
  requestedApiType = "",
  generationApiType = "",
  effectiveImageSize = "",
  modelSpec = {},
  requestUrl = "",
  requestMethod = "",
} = {}) {
  const resolvedApiType =
    generationApiType || resolveGenerationApiType(modelSpec || {}, requestedApiType);
  return {
    ...(message ? { message } : {}),
    modelAlias,
    model,
    apiType: resolvedApiType,
    requestedApiType: String(requestedApiType || "").trim(),
    callMode: generationApiTypeToCallMode(resolvedApiType),
    baseUrl: describeBaseUrlForDiagnostics(resolveModelBaseUrl(modelSpec || {})),
    requestUrl: describeBaseUrlForDiagnostics(requestUrl),
    requestMethod: String(requestMethod || "").trim().toUpperCase(),
    imageSize: String(effectiveImageSize || "").trim(),
    availableApiTypes: [...AVAILABLE_GENERATION_API_TYPES],
    apiTypeAliases: GENERATION_API_TYPE_ALIASES,
    platform: process.platform,
    proxyEnv: collectProxyEnvDiagnostics(),
  };
}

function buildMultimodalRequestHeaders(modelName = "", runtime = {}) {
  const sessionId = String(
    runtime?.systemRuntime?.sessionId || runtime?.systemRuntime?.rootSessionId || "",
  ).trim();
  const parentSessionId = resolveParentSessionId({ runtime });
  return {
    [MODEL_NAME_HEADER_KEY]: String(modelName || "").trim() || "unknown_model",
    ...buildPluginModelHeaders({
      flow: MULTIMODAL_FLOW_NAME,
      purpose: MULTIMODAL_PURPOSE_NAME,
      domain: MULTIMODAL_DOMAIN_NAME,
      sessionId,
    }),
    ...(parentSessionId ? { [PARENT_SESSION_HEADER_KEY]: parentSessionId } : {}),
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

function checkImageGenerationSupport(modelSpec = {}) {
  const multimodalGeneration = modelSpec?.multimodal_generation || {};
  const supportGeneration = multimodalGeneration?.support_generation || {};
  const generationEnabled = supportGeneration?.enabled === true;
  const supportScope = Array.isArray(supportGeneration?.support_scope)
    ? supportGeneration.support_scope.map((scopeItem) =>
        String(scopeItem || "").trim().toLowerCase(),
      )
    : [];
  const supportImageGeneration = supportScope.includes("image");
  return {
    generationEnabled,
    supportImageGeneration,
  };
}

function parseDataUrlToImageArtifact(dataUrl = "", fileName = "generated_image_1.png") {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;
  // Use the detected mimeType to generate a proper filename if fileName is default
  const finalFileName = fileName === "generated_image_1.png"
    ? sanitizeGeneratedArtifactName("generated_image_1", parsed.mimeType, 1)
    : fileName;
  return {
    fileName: finalFileName,
    b64Json: parsed.contentBase64,
    url: "",
  };
}

function normalizeImageSize(imageSize = "1024x1024") {
  const normalizedImageSize = String(imageSize || "1024x1024").trim();
  return normalizedImageSize || "1024x1024";
}

function normalizeStringArray(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function normalizeGenerationApiType(apiType = "") {
  const normalizedApiType = String(apiType || "").trim().toLowerCase();
  if (["images_async", "image_async", "images_generations", "images"].includes(normalizedApiType)) {
    return IMAGE_GENERATION_API_TYPE.IMAGES_ASYNC;
  }
  if (["openai_responses", "responses", "responses_api", "openai_responses_api"].includes(normalizedApiType)) {
    return IMAGE_GENERATION_API_TYPE.OPENAI_RESPONSES;
  }
  return "";
}

function resolveGenerationApiType(modelSpec = {}, requestedApiType = "") {
  const normalizedRequestedApiType = normalizeGenerationApiType(requestedApiType);
  if (normalizedRequestedApiType) return normalizedRequestedApiType;
  const supportGeneration = modelSpec?.multimodal_generation?.support_generation || {};
  return normalizeGenerationApiType(
    supportGeneration?.api_type ||
      supportGeneration?.apiType ||
      supportGeneration?.endpoint ||
      supportGeneration?.generation_api ||
      "",
  ) || IMAGE_GENERATION_API_TYPE.OPENAI_RESPONSES;
}

function shouldAppendApiTypeHint(error = {}) {
  if (error?.apiTypeSwitchHint === true) return true;
  if (error?.code) {
    return String(error.code || "") === ERROR_CODE.RECOVERABLE_MULTIMODAL_GENERATE_FAILED;
  }
  return Boolean(error?.status || error?.statusCode || error?.payload);
}

function appendApiTypeHint(message = "", runtime = {}) {
  const baseMessage = String(message || "").trim() || tMultimodal(runtime, "generateFailed");
  const hint = tMultimodal(runtime, "trySwitchApiType");
  return hint ? `${baseMessage}\n${hint}` : baseMessage;
}

function dedupeAttachments(attachments = []) {
  const source = Array.isArray(attachments) ? attachments : [];
  const seen = new Set();
  return source.filter((item = {}) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const key = String(item?.attachmentId || "").trim() ||
      `${String(item?.path || "").trim()}|${String(item?.relativePath || "").trim()}|${String(item?.name || "").trim()}`;
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolveGenerationModelSpec({
  modelName = "",
  runtimeModel = "",
  globalConfig = {},
  userConfig = {},
}) {
  const preferredModelName = String(modelName || "").trim();
  const currentRuntimeModel = String(runtimeModel || "").trim();
  const resolvedModelName = preferredModelName || currentRuntimeModel;
  const resolvedModelSpec = resolvedModelName
    ? resolveModelSpecByName({
        modelName: resolvedModelName,
        globalConfig,
        userConfig,
        fallbackToDefault: true,
      })
    : resolveDefaultModelSpec({ globalConfig, userConfig });
  return {
    resolvedModelName,
    resolvedModelSpec,
  };
}

function extractImageArtifactsFromResponsesOutput(responseOutputItems = []) {
  const normalizedOutputItems = Array.isArray(responseOutputItems)
    ? responseOutputItems
    : [];
  const imageArtifacts = [];
  let imageIndex = 0;
  for (const outputItem of normalizedOutputItems) {
    if (!outputItem || typeof outputItem !== "object") continue;
    const outputItemType = String(outputItem?.type || "").trim().toLowerCase();
    const directBase64 = String(
      outputItem?.result || outputItem?.b64_json || outputItem?.image_base64 || "",
    ).trim();
    if (outputItemType.includes("image") && directBase64) {
      imageIndex += 1;
      imageArtifacts.push({
        fileName: `generated_image_${imageIndex}.png`,
        b64Json: directBase64,
        url: "",
      });
      continue;
    }
    const outputContents = Array.isArray(outputItem?.content) ? outputItem.content : [];
    for (const contentItem of outputContents) {
      if (!contentItem || typeof contentItem !== "object") continue;
      const contentItemType = String(contentItem?.type || "").trim().toLowerCase();
      const contentItemBase64 = String(
        contentItem?.result ||
          contentItem?.b64_json ||
          contentItem?.image_base64 ||
          contentItem?.data ||
          "",
      ).trim();
      const imageDataUrl = String(contentItem?.image_url?.url || "").trim();
      if (contentItemType.includes("image") && contentItemBase64) {
        imageIndex += 1;
        imageArtifacts.push({
          fileName: `generated_image_${imageIndex}.png`,
          b64Json: contentItemBase64,
          url: "",
        });
        continue;
      }
      if (contentItemType.includes("image") && imageDataUrl.startsWith("data:image/")) {
        imageIndex += 1;
        const parsedArtifact = parseDataUrlToImageArtifact(
          imageDataUrl,
          `generated_image_${imageIndex}.png`,
        );
        if (parsedArtifact) imageArtifacts.push(parsedArtifact);
      }
    }
  }
  return imageArtifacts;
}

async function generateWithOpenaiResponsesApi({
  openaiClient,
  modelName,
  generationContent,
  imageSize,
}) {
  const generationResult = await openaiClient.responses.create({
    model: String(modelName || "").trim(),
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: String(generationContent || "").trim() }],
      },
    ],
    tools: [
      {
        type: "image_generation",
        size: normalizeImageSize(imageSize),
      },
    ],
  });
  return {
    imageArtifacts: extractImageArtifactsFromResponsesOutput(generationResult?.output || []),
    rawText: String(generationResult?.output_text || "").trim(),
  };
}



export function createMultimodalGenerateTool({ agentContext }) {
  const runtime = agentContext?.runtime || {};
  const effectiveConfig = mergeConfig(
    runtime?.globalConfig || {},
    runtime?.userConfig || {},
  );
  const toolEnabled =
    effectiveConfig?.tools?.[TOOL_NAME.MULTIMODAL_GENERATE]?.enabled !== false;
  if (!toolEnabled) return [];

  const globalConfig = runtime?.globalConfig || {};
  const userConfig = runtime?.userConfig || {};
  const attachmentService = runtime?.attachmentService || null;
  const userId = String(runtime?.userId || agentContext?.userId || "").trim();
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
      model_name: z
        .string()
        .optional()
        .describe(tTool(runtime, "tools.multimodal.fieldModelName")),
      size: z
        .string()
        .optional()
        .describe(tTool(runtime, "tools.multimodal.fieldSize")),
      image_size: z
        .string()
        .optional()
        .describe(tTool(runtime, "tools.multimodal.fieldImageSize")),
      resolution: z
        .string()
        .optional()
        .describe(tTool(runtime, "tools.multimodal.fieldResolution")),
      n: z
        .number()
        .optional()
        .describe(tTool(runtime, "tools.multimodal.fieldN")),
      quality: z
        .string()
        .optional()
        .describe(tTool(runtime, "tools.multimodal.fieldQuality")),
      image_urls: z
        .array(z.string())
        .optional()
        .describe(tTool(runtime, "tools.multimodal.fieldImageUrls")),
      api_type: z
        .string()
        .optional()
        .describe(tTool(runtime, "tools.multimodal.fieldApiType")),
    }),
    func: async ({
      generation_content,
      model_name = "",
      image_size = "",
      size = "",
      resolution = "",
      n = 1,
      quality = "",
      image_urls = [],
      api_type = "",
    }) => {
      const generationContent = String(generation_content || "").trim();
      let resolvedModelSpec = null;
      let generationApiType = "";
      let effectiveImageSize = "";
      const requestedApiType = String(api_type || "").trim();
      if (!generationContent) {
        throw recoverableToolError(tMultimodal(runtime, "generationContentRequired"), {
          code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
        });
      }
      try {
        const {
          resolvedModelName,
          resolvedModelSpec: selectedModelSpec,
        } = resolveGenerationModelSpec({
          modelName: model_name,
          runtimeModel: runtime?.runtimeModel,
          globalConfig,
          userConfig,
        });
        resolvedModelSpec = selectedModelSpec;
        const generationSupport = checkImageGenerationSupport(
          resolvedModelSpec || {},
        );
        if (
          !generationSupport.generationEnabled ||
          !generationSupport.supportImageGeneration
        ) {
          const currentModelAlias = String(
            resolvedModelSpec?.alias || resolvedModelName || "",
          ).trim();
          const currentModelName = String(resolvedModelSpec?.model || "").trim();
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
        const modelNameForGeneration = String(
          resolvedModelSpec?.model || resolvedModelName || "",
        ).trim();
        generationApiType = resolveGenerationApiType(resolvedModelSpec || {}, requestedApiType);
        effectiveImageSize = String(size || image_size || "").trim() ||
          (generationApiType === IMAGE_GENERATION_API_TYPE.IMAGES_ASYNC ? "1:1" : "1024x1024");
        const modelApiKey = resolveModelApiKey(resolvedModelSpec || {});
        if (!modelApiKey) {
          throw recoverableToolError(tMultimodal(runtime, "modelApiKeyMissing"), {
            code: ERROR_CODE.RECOVERABLE_MODEL_API_KEY_MISSING,
            details: {
              modelAlias: String(resolvedModelSpec?.alias || "").trim(),
              model: String(resolvedModelSpec?.model || "").trim(),
            },
          });
        }
        const generationResult =
          generationApiType === IMAGE_GENERATION_API_TYPE.IMAGES_ASYNC
            ? await generateWithImagesAsyncApi({
                fetchImpl: sharedFetch,
                baseUrl: resolveModelBaseUrl(resolvedModelSpec || {}),
                apiKey: modelApiKey,
                modelName: modelNameForGeneration,
                generationContent,
                imageSize: effectiveImageSize,
                resolution,
                n,
                quality,
                imageUrls: normalizeStringArray(image_urls),
                taskIdMissingMessage: tMultimodal(runtime, "taskIdMissing"),
                taskFailedMessage: tMultimodal(runtime, "taskFailed"),
                taskTimeoutMessageBuilder: (taskId) => tMultimodal(runtime, "taskTimeout", { taskId }),
              })
            : await generateWithOpenaiResponsesApi({
                openaiClient: new OpenAI({
                  apiKey: modelApiKey,
                  ...(resolveModelBaseUrl(resolvedModelSpec || {})
                    ? { baseURL: resolveModelBaseUrl(resolvedModelSpec || {}) }
                    : {}),
                  defaultHeaders: buildMultimodalRequestHeaders(modelNameForGeneration, runtime),
                }),
                modelName: modelNameForGeneration,
                generationContent,
                imageSize: effectiveImageSize,
              });
        const imageArtifacts = Array.isArray(generationResult?.imageArtifacts)
          ? generationResult.imageArtifacts
          : [];
        const generatedAttachments = [];
        for (const imageArtifact of imageArtifacts) {
          const resolvedBase64 =
            imageArtifact.b64Json ||
            (await imageUrlToBase64(imageArtifact.url, sharedFetch, runtime));
          if (!resolvedBase64) continue;
          generatedAttachments.push({
            name: imageArtifact.fileName,
            mimeType: MIME_TYPE.IMAGE_PNG,
            contentBase64: resolvedBase64,
          });
        }
        const attachmentRecords =
          attachmentService && userId && generatedAttachments.length
            ? await attachmentService.ingestGeneratedArtifacts({
                userId,
                sessionId: String(
                  runtime?.systemRuntime?.sessionId ||
                    runtime?.systemRuntime?.rootSessionId ||
                    "",
                ).trim(),
                attachmentSource: TOOL_ATTACHMENT_SOURCE.MODEL,
                artifacts: generatedAttachments,
                generationSource: ARTIFACT_GENERATION_SOURCE.MULTIMODAL_GENERATE_TOOL,
              })
            : [];
        const mergedAttachments = dedupeAttachments(
          mapAttachmentRecordsToMetas(attachmentRecords, {
            fallbackMimeType: MIME_TYPE.IMAGE_PNG,
            fallbackGenerationSource: ARTIFACT_GENERATION_SOURCE.MULTIMODAL_GENERATE_TOOL,
          }),
        );
        return toToolJsonResult(
          TOOL_NAME.MULTIMODAL_GENERATE,
          {
            ok: true,
            status: TOOL_RESULT_STATUS.COMPLETED,
            callMode: generationApiTypeToCallMode(generationApiType),
            modelAlias: String(resolvedModelSpec?.alias || "").trim(),
            model: String(resolvedModelSpec?.model || "").trim(),
            text: String(generationResult?.rawText || "").trim(),
            generationContentSource: "tool_input_generation_content",
            attachments: mergedAttachments,
            summary: {
              task_id: String(generationResult?.taskId || "").trim(),
              generated_image_count: imageArtifacts.length,
              saved_attachment_count: mergedAttachments.length,
            },
          },
          true,
        );
      } catch (error) {
        const errorStatusCode = Number(error?.status || error?.statusCode || 0);
        const errorMessage = String(error?.message || String(error || "")).trim();
        const normalizedMessage = errorMessage.toLowerCase();
        const modelAlias = String(resolvedModelSpec?.alias || "").trim();
        const modelName = String(resolvedModelSpec?.model || "").trim();

        if (
          errorStatusCode === 403 &&
          normalizedMessage.includes("images api is not enabled")
        ) {
          const hintMessage = appendApiTypeHint(
            tMultimodal(runtime, "imagesApiNotEnabledError"),
            runtime,
          );
          throw recoverableToolError(hintMessage, {
            code: ERROR_CODE.RECOVERABLE_IMAGES_API_NOT_ENABLED,
            details: buildFailureDetails({
              message: hintMessage,
              modelAlias,
              model: modelName,
              requestedApiType,
              generationApiType,
              effectiveImageSize,
              modelSpec: resolvedModelSpec || {},
              requestUrl: error?.requestUrl,
              requestMethod: error?.requestMethod,
            }),
          });
        }
        if (!shouldAppendApiTypeHint(error)) {
          throw recoverableToolError(
            errorMessage || tMultimodal(runtime, "generateFailed"),
            {
              code: resolveGenerateErrorCode(error),
              details: buildFailureDetails({
                modelAlias,
                model: modelName,
                requestedApiType,
                generationApiType,
                effectiveImageSize,
                modelSpec: resolvedModelSpec || {},
                requestUrl: error?.requestUrl,
                requestMethod: error?.requestMethod,
              }),
            },
          );
        }
        const hintMessage = appendApiTypeHint(
          errorMessage || tMultimodal(runtime, "generateFailed"),
          runtime,
        );
        throw recoverableToolError(
          hintMessage,
          {
            code: resolveGenerateErrorCode(error),
            details: buildFailureDetails({
              message: hintMessage,
              modelAlias,
              model: modelName,
              requestedApiType,
              generationApiType,
              effectiveImageSize,
              modelSpec: resolvedModelSpec || {},
              requestUrl: error?.requestUrl,
              requestMethod: error?.requestMethod,
            }),
          },
        );
      }
    },
  });

  return [multimodalGenerateTool];
}
