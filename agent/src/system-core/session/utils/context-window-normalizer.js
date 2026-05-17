/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function filterSummarizedMessages(messages = []) {
  return (Array.isArray(messages) ? messages : []).filter(
    (messageItem) => messageItem?.summarized !== true,
  );
}

export function normalizeContextWindow({
  sourceMessages = [],
  startIndex = 0,
  limit = Number.POSITIVE_INFINITY,
} = {}) {
  const source = Array.isArray(sourceMessages) ? sourceMessages : [];
  const normalizedStartIndex = Math.max(0, Number(startIndex) || 0);
  const resolvedLimit = Number(limit);
  const useFiniteLimit = Number.isFinite(resolvedLimit);
  if (useFiniteLimit && resolvedLimit <= 0) return [];
  if (!source.length) return [];

  let windowMessages = source.slice(normalizedStartIndex);
  if (!windowMessages.length) return [];

  if (useFiniteLimit && windowMessages.length > Math.floor(resolvedLimit)) {
    const keepCount = Math.floor(resolvedLimit);
    windowMessages = windowMessages.slice(-keepCount);
  }

  let prependedUserAnchor = false;
  const hasUserMessage = windowMessages.some(
    (messageItem) => String(messageItem?.role || "") === "user",
  );
  if (!hasUserMessage && normalizedStartIndex > 0) {
    for (let index = normalizedStartIndex - 1; index >= 0; index -= 1) {
      const messageItem = source[index];
      if (String(messageItem?.role || "") !== "user") continue;
      windowMessages = [messageItem, ...windowMessages];
      prependedUserAnchor = true;
      break;
    }
  }

  if (useFiniteLimit && windowMessages.length > Math.floor(resolvedLimit)) {
    while (windowMessages.length > Math.floor(resolvedLimit)) {
      if (prependedUserAnchor && windowMessages.length > 1) {
        windowMessages.splice(1, 1);
      } else {
        windowMessages.shift();
      }
    }
  }

  const knownToolCallIds = new Set();
  for (const messageItem of windowMessages) {
    if (String(messageItem?.role || "") !== "assistant") continue;
    const toolCalls = Array.isArray(messageItem?.tool_calls)
      ? messageItem.tool_calls
      : [];
    for (const toolCall of toolCalls) {
      const toolCallId = String(
        toolCall?.id || toolCall?.tool_call_id || "",
      ).trim();
      if (toolCallId) knownToolCallIds.add(toolCallId);
    }
  }

  return windowMessages.filter((messageItem) => {
    if (String(messageItem?.role || "") !== "tool") return true;
    const toolCallId = String(messageItem?.tool_call_id || "").trim();
    if (!toolCallId) return true;
    return knownToolCallIds.has(toolCallId);
  });
}

export function normalizeRecentWindow(messages = [], limit = 20) {
  const source = Array.isArray(messages) ? messages : [];
  const resolvedLimit = Number(limit);
  if (!Number.isFinite(resolvedLimit) || resolvedLimit <= 0) return [];
  const startIndex = Math.max(0, source.length - Math.floor(resolvedLimit));
  return normalizeContextWindow({
    sourceMessages: source,
    startIndex,
    limit: resolvedLimit,
  });
}
