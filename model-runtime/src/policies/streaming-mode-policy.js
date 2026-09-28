/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const EXPLICIT_ERROR_CODES = new Set([
  "aborted",
  "authentication",
  "authorization",
  "credential_missing",
  "content_policy",
  "context_length",
  "invalid_api_key",
  "quota_exceeded",
  "rate_limit",
]);

const EXPLICIT_ERROR_TEXT = [
  "context length",
  "context window",
  "maximum context",
  "content policy",
  "invalid api key",
  "incorrect api key",
  "quota exceeded",
  "insufficient quota",
  "permission denied",
  "not authorized",
  "authentication failed",
  "request was cancelled",
  "request was canceled",
];

export function streamingProviderCacheKey({ model = {}, operation = {}, tools = [] } = {}) {
  return JSON.stringify([
    String(model.operatorId || "").trim(),
    String(model.adapterId || "").trim(),
    String(model.base_url || model.baseUrl || "").trim(),
    String(model.model || "").trim(),
    String(operation?.kind || "chat").trim(),
    Array.isArray(tools) && tools.length > 0,
  ]);
}

export function resolvePreferredStreaming({ requested, cached } = {}) {
  return typeof cached === "boolean" ? cached : requested === true;
}

export function isExplicitModelError(error = {}) {
  const code = String(error?.code || error?.kind || error?.cause?.code || "")
    .trim()
    .toLowerCase();
  if (EXPLICIT_ERROR_CODES.has(code)) return true;
  const message = String(error?.message || error || "").toLowerCase();
  return EXPLICIT_ERROR_TEXT.some((text) => message.includes(text));
}

export function mayRetryWithAlternateStreaming(
  error = {},
  streamedTokens = 0,
  classification = {},
) {
  const classifiedKind = String(classification?.kind || classification?.code || "")
    .trim()
    .toLowerCase();
  return (
    Number(streamedTokens || error?.streamedTokens || 0) === 0 &&
    !isExplicitModelError(error) &&
    !EXPLICIT_ERROR_CODES.has(classifiedKind)
  );
}

export function alternateStreamingMode(mode) {
  return mode !== true;
}
