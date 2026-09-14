/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const MODEL_MULTIMODAL_MODALITY = Object.freeze({
  IMAGE: "image",
  DOCUMENT: "document",
  AUDIO: "audio",
  VIDEO: "video",
});

export const MODEL_IMAGE_GENERATION_API_TYPE = Object.freeze({
  OPENAI_RESPONSES: "openai_responses",
  IMAGES_ASYNC: "images_async",
});

const IMAGE_GENERATION_API_TYPES = new Set(Object.values(MODEL_IMAGE_GENERATION_API_TYPE));

export function resolveModelImageGenerationApiType(modelSpec = {}) {
  const apiType = String(modelSpec?.multimodal_generation?.support_generation?.api_type || "")
    .trim()
    .toLowerCase();
  return IMAGE_GENERATION_API_TYPES.has(apiType)
    ? apiType
    : MODEL_IMAGE_GENERATION_API_TYPE.OPENAI_RESPONSES;
}

const MULTIMODAL_MODALITIES = new Set(Object.values(MODEL_MULTIMODAL_MODALITY));

function normalizeModalities(value) {
  return Object.freeze(
    Array.from(
      new Set(
        (Array.isArray(value) ? value : [])
          .map((item) =>
            String(item || "")
              .trim()
              .toLowerCase(),
          )
          .filter((item) => MULTIMODAL_MODALITIES.has(item)),
      ),
    ),
  );
}

function normalizeRequiredModalities(value) {
  return Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map((item) =>
          String(item || "")
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean),
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
