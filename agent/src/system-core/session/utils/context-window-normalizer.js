/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  filterForModelContext,
  filterInjectedMessagesForDialog,
} from "../../context/session/message-context-policy.js";

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

  let windowStartIndex = normalizedStartIndex;
  let windowMessages = source.slice(normalizedStartIndex);
  if (!windowMessages.length) return [];

  if (useFiniteLimit && windowMessages.length > Math.floor(resolvedLimit)) {
    const keepCount = Math.floor(resolvedLimit);
    windowMessages = windowMessages.slice(-keepCount);
    windowStartIndex = Math.max(0, source.length - keepCount);
  }

  let prependedUserAnchor = false;
  const firstRole = String(windowMessages[0]?.role || "").trim().toLowerCase();
  const shouldAnchorByFirstAssistant = firstRole === "assistant";
  const hasUserMessage = windowMessages.some(
    (messageItem) => String(messageItem?.role || "").trim().toLowerCase() === "user",
  );
  if ((shouldAnchorByFirstAssistant || !hasUserMessage) && windowStartIndex > 0) {
    for (let index = windowStartIndex - 1; index >= 0; index -= 1) {
      const messageItem = source[index];
      if (String(messageItem?.role || "").trim().toLowerCase() !== "user") continue;
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

export function resolveModelContextMessages({
  sourceMessages = [],
  currentDialogProcessId = "",
  mode = "agent",
  normalizeMessage = null,
  shouldKeepMessage = null,
  useRecentWindow = false,
  recentLimit = 20,
  startIndex = 0,
  limit = Number.POSITIVE_INFINITY,
} = {}) {
  const normalizedMode = String(mode || "agent").trim().toLowerCase();
  const useRecentWindowByMode =
    normalizedMode === "harness" ? true : useRecentWindow === true;
  const sameDialogMessages = filterInjectedMessagesForDialog(
    sourceMessages,
    currentDialogProcessId,
  );
  const mappedMessages =
    typeof normalizeMessage === "function"
      ? sameDialogMessages
          .map((messageItem) => normalizeMessage(messageItem))
          .filter(Boolean)
      : sameDialogMessages;
  const filteredMessages =
    typeof shouldKeepMessage === "function"
      ? mappedMessages.filter((messageItem) => shouldKeepMessage(messageItem))
      : mappedMessages;
  if (useRecentWindowByMode) {
    return normalizeRecentWindow(filteredMessages, recentLimit);
  }
  return normalizeContextWindow({
    sourceMessages: filteredMessages,
    startIndex,
    limit,
  });
}
