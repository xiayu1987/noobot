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

const MULTIMODAL_MODALITIES = new Set(Object.values(MODEL_MULTIMODAL_MODALITY));

function normalizeModalities(value) {
  return Object.freeze(
    Array.from(
      new Set(
        (Array.isArray(value) ? value : [])
          .map((item) => String(item || "").trim().toLowerCase())
          .filter((item) => MULTIMODAL_MODALITIES.has(item)),
      ),
    ),
  );
}

function normalizeRequiredModalities(value) {
  return Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map((item) => String(item || "").trim().toLowerCase())
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
      apiType: String(generation?.api_type || "").trim().toLowerCase(),
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
