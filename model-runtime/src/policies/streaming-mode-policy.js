/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";
import { MODEL_ERROR_KIND } from "@noobot/model-protocol";

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
    text(model.operatorId),
    text(model.adapterId),
    text(model.base_url),
    text(model.model),
    text(operation?.kind) || "chat",
    Array.isArray(tools) && tools.length > 0,
  ]);
}

export function resolvePreferredStreaming({ requested, cached } = {}) {
  return typeof cached === "boolean" ? cached : requested === true;
}

function isExplicitProviderError(error) {
  const code = text(error?.code || error?.cause?.code).toLowerCase();
  if (EXPLICIT_ERROR_CODES.has(code)) return true;
  const message = String(error?.message || error || "").toLowerCase();
  return EXPLICIT_ERROR_TEXT.some((inputText) => message.includes(inputText));
}

export function mayRetryWithAlternateStreaming(error, streamedTokens, classification) {
  const classifiedKind = classification.kind.toLowerCase();
  return (
    classification.kind !== MODEL_ERROR_KIND.CLASSIFICATION &&
    streamedTokens === 0 &&
    !isExplicitProviderError(error) &&
    !EXPLICIT_ERROR_CODES.has(classifiedKind)
  );
}

export function alternateStreamingMode(mode) {
  return mode !== true;
}
