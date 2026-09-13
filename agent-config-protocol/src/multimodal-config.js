/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "./utils.js";

export const MULTIMODAL_CONFIG_OPERATION = Object.freeze({
  PARSING: "parsing",
  GENERATION: "generation",
});

export const MULTIMODAL_CONFIG_MODALITY = Object.freeze({
  AUDIO: "audio",
  VIDEO: "video",
  IMAGE: "image",
  DOCUMENT: "document",
});

const OPERATIONS = new Set(Object.values(MULTIMODAL_CONFIG_OPERATION));
const MODALITIES = new Set(Object.values(MULTIMODAL_CONFIG_MODALITY));

function normalizeRequiredModalities(value = []) {
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

export function resolveMultimodalDefaultModelSelection(
  effectiveConfig = {},
  { operation = "", modalities = [] } = {},
) {
  const normalizedOperation = String(operation || "")
    .trim()
    .toLowerCase();
  if (!OPERATIONS.has(normalizedOperation)) {
    throw new TypeError(
      `unsupported multimodal config operation: ${normalizedOperation || "missing"}`,
    );
  }
  const requiredModalities = normalizeRequiredModalities(modalities);
  const invalidModalities = requiredModalities.filter((item) => !MODALITIES.has(item));
  if (invalidModalities.length) {
    throw new TypeError(`unsupported multimodal modalities: ${invalidModalities.join(", ")}`);
  }
  const operationConfig = effectiveConfig?.multimodal?.[normalizedOperation] || {};
  const defaultModels = isPlainObject(operationConfig?.defaultModels)
    ? operationConfig.defaultModels
    : {};
  const modelAliases = requiredModalities.map((modality) =>
    String(defaultModels?.[modality] || "").trim(),
  );
  const missingModalities = requiredModalities.filter((_, index) => !modelAliases[index]);
  const configuredAliases = Array.from(new Set(modelAliases.filter(Boolean)));
  return Object.freeze({
    operation: normalizedOperation,
    modalities: Object.freeze(requiredModalities),
    alias:
      missingModalities.length === 0 && configuredAliases.length === 1 ? configuredAliases[0] : "",
    configuredAliases: Object.freeze(configuredAliases),
    missingModalities: Object.freeze(missingModalities),
    conflicting: configuredAliases.length > 1,
  });
}
