/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";
export const MODEL_MULTIMODAL_MODALITY = Object.freeze({
  IMAGE: "image",
  DOCUMENT: "document",
  AUDIO: "audio",
  VIDEO: "video",
});

export const MODEL_GENERATION_API_TYPE = Object.freeze({
  OPENAI_IMAGES: "openai_images",
  XAI_IMAGES: "xai_images",
  GEMINI_INTERACTIONS: "gemini_interactions",
  GEMINI_GENERATE_CONTENT: "gemini_generate_content",
  DASHSCOPE_MULTIMODAL: "dashscope_multimodal",
  XAI_VIDEO: "xai_video",
  DASHSCOPE_VIDEO: "dashscope_video",
  MINIMAX_VIDEO: "minimax_video",
});

export const MODEL_GENERATION_API_HEADERS = Object.freeze({
  [MODEL_GENERATION_API_TYPE.GEMINI_INTERACTIONS]: Object.freeze({ "Api-Revision": "2026-05-20" }),
});

const GENERATION_API_OUTPUTS = Object.freeze({
  [MODEL_GENERATION_API_TYPE.OPENAI_IMAGES]: ["image"],
  [MODEL_GENERATION_API_TYPE.XAI_IMAGES]: ["image"],
  [MODEL_GENERATION_API_TYPE.GEMINI_INTERACTIONS]: ["image", "video"],
  [MODEL_GENERATION_API_TYPE.GEMINI_GENERATE_CONTENT]: ["image"],
  [MODEL_GENERATION_API_TYPE.DASHSCOPE_MULTIMODAL]: ["image"],
  [MODEL_GENERATION_API_TYPE.XAI_VIDEO]: ["video"],
  [MODEL_GENERATION_API_TYPE.DASHSCOPE_VIDEO]: ["video"],
  [MODEL_GENERATION_API_TYPE.MINIMAX_VIDEO]: ["video"],
});

export function resolveModelGenerationApiType(modelSpec = {}) {
  const generation = modelSpec?.multimodal_generation?.support_generation;
  const apiType = text(generation?.api_type).toLowerCase();
  const outputs = GENERATION_API_OUTPUTS[apiType];
  if (!outputs) throw new TypeError(`unsupported model generation API type: ${apiType}`);
  if (generation.support_scope?.some((modality) => !outputs.includes(modality)))
    throw new TypeError(`generation API ${apiType} does not support declared output modalities`);
  if (
    apiType === MODEL_GENERATION_API_TYPE.DASHSCOPE_VIDEO &&
    !["auto", "text", "image", "reference"].includes(generation.input_mode)
  )
    throw new TypeError("DashScope video requires an explicit input_mode declaration");
  return apiType;
}

const MULTIMODAL_MODALITIES = new Set(Object.values(MODEL_MULTIMODAL_MODALITY));

function normalizeModalities(value) {
  return Object.freeze(
    Array.from(
      new Set(
        (Array.isArray(value) ? value : [])
          .map((item) => text(item).toLowerCase())
          .filter((item) => MULTIMODAL_MODALITIES.has(item)),
      ),
    ),
  );
}

function normalizeRequiredModalities(value) {
  return Array.from(
    new Set(
      (Array.isArray(value) ? value : []).map((item) => text(item).toLowerCase()).filter(Boolean),
    ),
  );
}

export function resolveModelMultimodalCapabilities(modelSpec = {}) {
  const parsing = modelSpec?.multimodal_parsing || {};
  const generation = modelSpec?.multimodal_generation?.support_generation || {};
  return Object.freeze({
    parsing: Object.freeze({
      enabled: parsing?.enabled === true,
      inputModalities: normalizeModalities(parsing?.input_modalities),
    }),
    generation: Object.freeze({
      enabled: generation?.enabled === true,
      outputModalities: normalizeModalities(generation?.support_scope),
    }),
  });
}

export function supportsModelMultimodalParsing(modelSpec = {}, requiredModalities = []) {
  const capabilities = resolveModelMultimodalCapabilities(modelSpec).parsing;
  if (!capabilities.enabled) return false;
  const supported = new Set(capabilities.inputModalities);
  return normalizeRequiredModalities(requiredModalities).every((item) => supported.has(item));
}

export function supportsModelMultimodalGeneration(modelSpec = {}, requiredModalities = []) {
  const capabilities = resolveModelMultimodalCapabilities(modelSpec).generation;
  if (!capabilities.enabled) return false;
  const supported = new Set(capabilities.outputModalities);
  return normalizeRequiredModalities(requiredModalities).every((item) => supported.has(item));
}
