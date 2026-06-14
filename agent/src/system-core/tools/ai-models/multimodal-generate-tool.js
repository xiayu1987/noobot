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
import { recoverableToolError } from "../../error/index.js";
import { ERROR_CODE } from "../../error/constants.js";
import { MIME_TYPE } from "../../constants/index.js";
import { resolveParentSessionId } from "../../context/parent-session-id-resolver.js";
import {
  ARTIFACT_GENERATION_SOURCE,
  TOOL_ATTACHMENT_SOURCE,
  TOOL_CALL_MODE,
  TOOL_NAME,
  TOOL_RESULT_STATUS,
} from "../constants/index.js";

const MODEL_NAME_HEADER_KEY = "X-Model-Name";
const FLOW_HEADER_KEY = "X-Harness-Flow";
const PURPOSE_HEADER_KEY = "X-Harness-Purpose";
const DOMAIN_HEADER_KEY = "X-Harness-Domain";
const SESSION_HEADER_KEY = "X-Harness-Session-Id";
const PARENT_SESSION_HEADER_KEY = "parentSessionid";
const MULTIMODAL_FLOW_NAME = "agent.multimodal_generate";
const MULTIMODAL_PURPOSE_NAME = "multimodal_generate";
const MULTIMODAL_DOMAIN_NAME = "tool";

function tMultimodal(runtime = {}, key = "", params = {}) {
  return tTool(runtime, `tools.multimodal.${String(key || "").trim()}`, params);
}

function resolveModelApiKey(modelSpec = {}) {
  return String(modelSpec?.api_key || "").trim();
}

function resolveModelBaseUrl(modelSpec = {}) {
  return String(modelSpec.base_url || "").trim();
}

function buildMultimodalRequestHeaders(modelName = "", runtime = {}) {
  const sessionId = String(
    runtime?.systemRuntime?.sessionId || runtime?.systemRuntime?.rootSessionId || "",
  ).trim();
  const parentSessionId = resolveParentSessionId({ runtime });
  return {
    [MODEL_NAME_HEADER_KEY]: String(modelName || "").trim() || "unknown_model",
    [FLOW_HEADER_KEY]: MULTIMODAL_FLOW_NAME,
    [PURPOSE_HEADER_KEY]: MULTIMODAL_PURPOSE_NAME,
    [DOMAIN_HEADER_KEY]: MULTIMODAL_DOMAIN_NAME,
    ...(sessionId ? { [SESSION_HEADER_KEY]: sessionId } : {}),
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

function dedupeAttachmentMetas(attachmentMetas = []) {
  const source = Array.isArray(attachmentMetas) ? attachmentMetas : [];
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
      image_size: z
        .string()
        .optional()
        .describe(tTool(runtime, "tools.multimodal.fieldImageSize")),
    }),
    func: async ({ generation_content, model_name = "", image_size = "1024x1024" }) => {
      const generationContent = String(generation_content || "").trim();
      let resolvedModelSpec = null;
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
        const openaiClient = new OpenAI({
          apiKey: modelApiKey,
          ...(resolveModelBaseUrl(resolvedModelSpec || {})
            ? { baseURL: resolveModelBaseUrl(resolvedModelSpec || {}) }
            : {}),
          defaultHeaders: buildMultimodalRequestHeaders(modelNameForGeneration, runtime),
        });
        const generationResult = await generateWithOpenaiResponsesApi({
          openaiClient,
          modelName: modelNameForGeneration,
          generationContent,
          imageSize: image_size,
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
        const mergedAttachmentMetas = dedupeAttachmentMetas(
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
            callMode: TOOL_CALL_MODE.OPENAI_RESPONSES_API,
            modelAlias: String(resolvedModelSpec?.alias || "").trim(),
            model: String(resolvedModelSpec?.model || "").trim(),
            text: String(generationResult?.rawText || "").trim(),
            generationContentSource: "tool_input_generation_content",
            attachmentMetas: mergedAttachmentMetas,
            summary: {
              generated_image_count: imageArtifacts.length,
              saved_attachment_count: mergedAttachmentMetas.length,
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
          throw recoverableToolError(tMultimodal(runtime, "imagesApiNotEnabledError"), {
            code: ERROR_CODE.RECOVERABLE_IMAGES_API_NOT_ENABLED,
            details: {
              message: tMultimodal(runtime, "imagesApiNotEnabledMessage"),
              modelAlias,
              model: modelName,
            },
          });
        }
        throw recoverableToolError(
          errorMessage || tMultimodal(runtime, "generateFailed"),
          {
            code: String(error?.code || ERROR_CODE.RECOVERABLE_MULTIMODAL_GENERATE_FAILED),
            details: {
              modelAlias,
              model: modelName,
            },
          },
        );
      }
    },
  });

  return [multimodalGenerateTool];
}
