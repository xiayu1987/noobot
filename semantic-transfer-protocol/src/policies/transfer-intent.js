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

export function normalizeTransferSource(value = "", { fallback = TRANSFER_SOURCE.SERVICE } = {}) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return fallback;
  if (KNOWN_SOURCES.has(normalized)) return normalized;
  throw new Error(`unknown_transfer_source:${normalized}`);
}

export function normalizeTransferReason(
  value = "",
  { fallback = TRANSFER_REASON.SEMANTIC_TRANSFER_OUTPUT } = {},
) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return fallback;
  if (KNOWN_REASONS.has(normalized)) return normalized;
  if (TRANSFER_REASON_ALIAS[normalized]) return TRANSFER_REASON_ALIAS[normalized];
  throw new Error(`unknown_transfer_reason:${normalized}`);
}

export function resolveTransferIntent({
  source = "",
  reason = "",
  fallbackSource = TRANSFER_SOURCE.SERVICE,
  fallbackReason = TRANSFER_REASON.SEMANTIC_TRANSFER_OUTPUT,
} = {}) {
  return {
    source: normalizeTransferSource(source, { fallback: fallbackSource }),
    reason: normalizeTransferReason(reason, { fallback: fallbackReason }),
  };
}

export function assertTransferIntentVocabulary({ source, reason } = {}) {
  if (!KNOWN_SOURCES.has(normalizeString(source).toLowerCase()))
    throw new Error(`unknown_transfer_source:${normalizeString(source)}`);
  if (!KNOWN_REASONS.has(normalizeString(reason).toLowerCase()))
    throw new Error(`unknown_transfer_reason:${normalizeString(reason)}`);
}
