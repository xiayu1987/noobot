/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";
import { resolveModelFailureRecovery } from "@noobot/model-protocol";

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
  return (
    streamedTokens === 0 &&
    resolveModelFailureRecovery(classification).revision === "set_streaming_mode"
  );
}

export function alternateStreamingMode(mode) {
  return mode !== true;
}
