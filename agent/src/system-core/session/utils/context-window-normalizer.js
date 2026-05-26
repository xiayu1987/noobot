/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { filterForModelContext } from "../../context/session/message-context-policy.js";

export function filterSummarizedMessages(messages = []) {
  return filterForModelContext(messages);
}

export function normalizeContextWindow({
  sourceMessages = [],
  startIndex = 0,
  limit = Number.POSITIVE_INFINITY,
} = {}) {
  const source = filterSummarizedMessages(sourceMessages);
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

  return filterSummarizedMessages(windowMessages);
}

export function normalizeRecentWindow(messages = [], limit = 20) {
  const source = filterSummarizedMessages(messages);
  const resolvedLimit = Number(limit);
  if (!Number.isFinite(resolvedLimit) || resolvedLimit <= 0) return [];
  const startIndex = Math.max(0, source.length - Math.floor(resolvedLimit));
  return normalizeContextWindow({
    sourceMessages: source,
    startIndex,
    limit: resolvedLimit,
  });
}
