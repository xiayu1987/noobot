/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";
import { MODEL_ERROR_KIND } from "@noobot/model-protocol";

const MODE_INDEPENDENT_ERROR_KINDS = new Set([
  MODEL_ERROR_KIND.ABORTED,
  MODEL_ERROR_KIND.AUTHENTICATION,
  MODEL_ERROR_KIND.RATE_LIMIT,
  MODEL_ERROR_KIND.CLASSIFICATION,
  MODEL_ERROR_KIND.PROTOCOL,
]);

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

export function mayRetryWithAlternateStreaming(streamedTokens, classification) {
  return streamedTokens === 0 && !MODE_INDEPENDENT_ERROR_KINDS.has(classification.kind);
}

export function alternateStreamingMode(mode) {
  return mode !== true;
}
