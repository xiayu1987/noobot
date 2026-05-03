/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import OpenAI from "openai";
import { z } from "zod";
import { mergeConfig } from "../config/index.js";
import { mapAttachmentRecordsToMetas } from "../attach/index.js";
import {
  resolveDefaultModelSpec,
  resolveModelSpecByName,
} from "../model/index.js";
import { toToolJsonResult } from "./tool-json-result.js";
import { pickToolText, resolveToolLocale, tTool } from "./tool-i18n.js";

function tMultimodal(runtime = {}, key = "", params = {}) {
  const locale = resolveToolLocale(runtime);
  const dict = {
    imagesApiNotEnabledError: {
      "zh-CN": "当前账号未开通图片生成能力（403 Images API is not enabled）。",
      "en-US": "Current account does not have image generation enabled (403 Images API is not enabled).",
    },
    imagesApiNotEnabledMessage: {
      "zh-CN": "请在对应平台开通 Images API 权限，或切换到已开通图片生成能力的模型/密钥。",
      "en-US": "Enable Images API on your platform, or switch to a model/key with image generation enabled.",
    },
    multimodalUnsupportedError: {
      "zh-CN": `当前模型不支持多模态生成（图片）：${String(params.model || "").trim()}`,
      "en-US": `Current model does not support multimodal image generation: ${String(params.model || "").trim()}`,
    },
    multimodalUnsupportedMessage: {
      "zh-CN": "请切换到支持图片生成的模型，或通过 model_name 指定支持生成的模型。",
      "en-US": "Switch to a model that supports image generation, or specify one via model_name.",
    },
    generationContentRequired: {
      "zh-CN": "generation_content 必填",
      "en-US": "generation_content required",
    },
    modelApiKeyMissing: {
      "zh-CN": "模型 API Key 缺失",
      "en-US": "model api key missing",
    },
    generateFailed: {
      "zh-CN": "多模态生成失败",
      "en-US": "multimodal generate failed",
    },
    fetchGeneratedImageUrlFailed: {
      "zh-CN": "拉取生成图片 URL 失败",
      "en-US": "fetch generated image url failed",
    },
  };
  return pickToolText({ locale, dict, key, params });
}

function resolveModelApiKey(modelSpec = {}) {
  return String(modelSpec?.api_key || "").trim();
}

function resolveModelBaseUrl(modelSpec = {}) {
  return String(modelSpec.base_url || "").trim();
}

async function imageUrlToBase64(url = "", fetchImpl = null, runtime = {}) {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl || typeof fetchImpl !== "function") return "";
  const response = await fetchImpl(normalizedUrl);
  if (!response?.ok) {
    throw new Error(
      `${tMultimodal(runtime, "fetchGeneratedImageUrlFailed")}: HTTP ${response?.status || 500}`,
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
  const normalizedDataUrl = String(dataUrl || "").trim();
  const matchResult = normalizedDataUrl.match(/^data:image\/[^;]+;base64,([\s\S]+)$/i);
  if (!matchResult) return null;
  return {
    fileName,
    b64Json: String(matchResult[1] || "").trim(),
    url: "",
  };
}

function normalizeImageSize(imageSize = "1024x1024") {
  const normalizedImageSize = String(imageSize || "1024x1024").trim();
  return normalizedImageSize || "1024x1024";
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


function buildImageGenerationErrorResult({ error, resolvedModelSpec = {}, runtime = {} }) {
  const errorStatusCode = Number(error?.status || error?.statusCode || 0);
  const errorMessage = String(error?.message || String(error || "")).trim();
  const normalizedMessage = errorMessage.toLowerCase();
  const modelAlias = String(resolvedModelSpec?.alias || "").trim();
  const modelName = String(resolvedModelSpec?.model || "").trim();

  if (
    errorStatusCode === 403 &&
    normalizedMessage.includes("images api is not enabled")
  ) {
    return {
      ok: false,
      status: "failed",
      code: "RECOVERABLE_IMAGES_API_NOT_ENABLED",
      error: tMultimodal(runtime, "imagesApiNotEnabledError"),
      message: tMultimodal(runtime, "imagesApiNotEnabledMessage"),
      modelAlias,
      model: modelName,
    };
  }

  return {
    ok: false,
    status: "failed",
    error: errorMessage || tMultimodal(runtime, "generateFailed"),
    modelAlias,
    model: modelName,
  };
}

export function createMultimodalGenerateTool({ agentContext }) {
  const runtime = agentContext?.runtime || {};
  const effectiveConfig = mergeConfig(
    runtime?.globalConfig || {},
    runtime?.userConfig || {},
  );
  const toolEnabled =
    effectiveConfig?.tools?.multimodal_generate?.enabled !== false;
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
    name: "multimodal_generate",
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
        return toToolJsonResult("multimodal_generate", {
          ok: false,
          error: tMultimodal(runtime, "generationContentRequired"),
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
          return toToolJsonResult("multimodal_generate", {
            ok: false,
            status: "failed",
            code: "RECOVERABLE_MODEL_MULTIMODAL_GENERATION_UNSUPPORTED",
            error: tMultimodal(runtime, "multimodalUnsupportedError", {
              model: currentModelAlias || currentModelName || "unknown_model",
            }),
            message: tMultimodal(runtime, "multimodalUnsupportedMessage"),
            modelAlias: currentModelAlias,
            model: currentModelName,
          });
        }
        const modelNameForGeneration = String(
          resolvedModelSpec?.model || resolvedModelName || "",
        ).trim();
        const modelApiKey = resolveModelApiKey(resolvedModelSpec || {});
        if (!modelApiKey) {
          return toToolJsonResult("multimodal_generate", {
            ok: false,
            status: "failed",
            code: "RECOVERABLE_MODEL_API_KEY_MISSING",
            error: tMultimodal(runtime, "modelApiKeyMissing"),
          });
        }
        const openaiClient = new OpenAI({
          apiKey: modelApiKey,
          ...(resolveModelBaseUrl(resolvedModelSpec || {})
            ? { baseURL: resolveModelBaseUrl(resolvedModelSpec || {}) }
            : {}),
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
            mimeType: "image/png",
            contentBase64: resolvedBase64,
          });
        }
        const savedAttachmentRecords =
          attachmentService && userId && generatedAttachments.length
              ? await attachmentService.ingestGeneratedArtifacts({
                userId,
                sessionId: String(
                  runtime?.systemRuntime?.sessionId ||
                    runtime?.systemRuntime?.rootSessionId ||
                    "",
                ).trim(),
                attachmentSource: "model",
                artifacts: generatedAttachments,
                generationSource: "multimodal_generate_tool",
              })
            : [];
        const attachmentMetas = mapAttachmentRecordsToMetas(
          savedAttachmentRecords,
          {
            fallbackMimeType: "image/png",
            fallbackGenerationSource: "multimodal_generate_tool",
            userId,
          },
        );
        return toToolJsonResult(
          "multimodal_generate",
          {
            ok: true,
            status: "completed",
            callMode: "openai_responses_api",
            modelAlias: String(resolvedModelSpec?.alias || "").trim(),
            model: String(resolvedModelSpec?.model || "").trim(),
            text: String(generationResult?.rawText || "").trim(),
            generationContentSource: "tool_input_generation_content",
            attachmentMetas,
            summary: {
              generated_image_count: imageArtifacts.length,
              saved_attachment_count: attachmentMetas.length,
            },
          },
          true,
        );
      } catch (error) {
        return toToolJsonResult(
          "multimodal_generate",
          buildImageGenerationErrorResult({
            error,
            resolvedModelSpec:
              typeof resolvedModelSpec === "object" && resolvedModelSpec
                ? resolvedModelSpec
                : {},
            runtime,
          }),
        );
      }
    },
  });

  return [multimodalGenerateTool];
}
