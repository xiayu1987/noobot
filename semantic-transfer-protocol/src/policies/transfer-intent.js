/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TRANSFER_SOURCE } from "../constants.js";
import { TRANSFER_REASON, TRANSFER_REASON_ALIAS } from "../vocabulary.js";

const KNOWN_SOURCES = new Set(Object.values(TRANSFER_SOURCE));
const KNOWN_REASONS = new Set(Object.values(TRANSFER_REASON));

function normalizeString(value = "") {
  return String(value || "").trim();
}

export function normalizeTransferSource(
  value = "",
  { fallback = TRANSFER_SOURCE.SERVICE, allowCustom = true } = {},
) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return fallback;
  if (KNOWN_SOURCES.has(normalized)) return normalized;
  return allowCustom ? normalized : fallback;
}

export function normalizeTransferReason(
  value = "",
  { fallback = TRANSFER_REASON.SEMANTIC_TRANSFER_OUTPUT, allowCustom = true } = {},
) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return fallback;
  if (KNOWN_REASONS.has(normalized)) return normalized;
  if (TRANSFER_REASON_ALIAS[normalized]) return TRANSFER_REASON_ALIAS[normalized];
  return allowCustom ? normalized : fallback;
}

export function resolveTransferIntent({
  source = "",
  reason = "",
  generationSource = "",
  fallbackSource = TRANSFER_SOURCE.SERVICE,
  fallbackReason = TRANSFER_REASON.SEMANTIC_TRANSFER_OUTPUT,
  defaultGenerationSource = TRANSFER_REASON.SEMANTIC_TRANSFER_OUTPUT,
  allowCustom = true,
} = {}) {
  const normalizedSource = normalizeTransferSource(source, {
    fallback: fallbackSource,
    allowCustom,
  });
  const normalizedReason = normalizeTransferReason(reason, {
    fallback: fallbackReason,
    allowCustom,
  });
  const normalizedGenerationSource = normalizeTransferReason(generationSource, {
    fallback: "",
    allowCustom,
  });
  const resolvedGenerationSource =
    normalizedGenerationSource ||
    normalizedReason ||
    normalizeTransferReason(normalizedSource, {
      fallback: defaultGenerationSource,
      allowCustom,
    }) ||
    defaultGenerationSource;
  return {
    source: normalizedSource,
    reason: normalizedReason,
    generationSource: resolvedGenerationSource,
  };
}
