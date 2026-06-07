/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  filterForModelContext,
  getMessageToolCalls,
  shouldMarkCurrentTurnSummarizedByPolicy,
  shouldMarkCurrentTurnModelSummarizedByPolicy,
} from "./message-context-policy.js";

export const DEFAULT_TASK_SUMMARY_TOOL_NAME = "task_summary";

export function getMessageRole(messageItem = {}) {
  const explicitRole = String(messageItem?.role || "").trim();
  if (explicitRole) return explicitRole;
  const modelType = String(getModelMessageType(messageItem) || "")
    .trim()
    .toLowerCase();
  if (modelType === "ai") return "assistant";
  if (modelType === "human") return "user";
  if (modelType === "system") return "system";
  if (modelType === "tool") return "tool";
  return "";
}

export function getModelMessageType(messageItem = {}) {
  if (typeof messageItem?._getType === "function") {
    return String(messageItem._getType() || "");
  }
  return String(messageItem?.lc_kwargs?.type || messageItem?.type || "");
}

export function resolveToolNameFromMessage(messageItem = {}) {
  const explicitToolName = String(
    messageItem?.toolName || messageItem?.tool_name || "",
  ).trim();
  if (explicitToolName) return explicitToolName;
  try {
    const parsed = JSON.parse(String(messageItem?.content || ""));
    return String(parsed?.toolName || "").trim();
  } catch {
    return "";
  }
}

export function resolveToolNamesFromToolCalls(toolCalls = []) {
  return (Array.isArray(toolCalls) ? toolCalls : [])
    .map((toolCall) => {
      if (!toolCall || typeof toolCall !== "object") return "";
      if (toolCall.name) return String(toolCall.name || "").trim();
      const fn =
        toolCall.function && typeof toolCall.function === "object"
          ? toolCall.function
          : {};
      return String(fn.name || "").trim();
    })
    .filter(Boolean);
}

export function hasTaskSummaryToolCall(
  messageItem = {},
  { taskSummaryToolName = DEFAULT_TASK_SUMMARY_TOOL_NAME } = {},
) {
  return resolveToolNamesFromToolCalls(getMessageToolCalls(messageItem)).includes(
    taskSummaryToolName,
  );
}

export function isTaskSummaryToolMessage(
  messageItem = {},
  { taskSummaryToolName = DEFAULT_TASK_SUMMARY_TOOL_NAME } = {},
) {
  return resolveToolNameFromMessage(messageItem) === taskSummaryToolName;
}

export function shouldMarkCurrentTurnSummarizedMessage(
  messageItem = {},
  { taskSummaryToolName = DEFAULT_TASK_SUMMARY_TOOL_NAME } = {},
) {
  if (hasTaskSummaryToolCall(messageItem, { taskSummaryToolName })) return false;
  if (isTaskSummaryToolMessage(messageItem, { taskSummaryToolName })) return false;
  return shouldMarkCurrentTurnSummarizedByPolicy(messageItem);
}

export function shouldMarkCurrentTurnSummarizedModelMessage(
  messageItem = {},
  { taskSummaryToolName = DEFAULT_TASK_SUMMARY_TOOL_NAME } = {},
) {
  if (hasTaskSummaryToolCall(messageItem, { taskSummaryToolName })) return false;
  if (isTaskSummaryToolMessage(messageItem, { taskSummaryToolName })) return false;
  return shouldMarkCurrentTurnModelSummarizedByPolicy(messageItem);
}

export function markCurrentTurnStoreSummarized(
  turnMessageStore = null,
  { taskSummaryToolName = DEFAULT_TASK_SUMMARY_TOOL_NAME } = {},
) {
  if (!turnMessageStore || typeof turnMessageStore.updateWhere !== "function") {
    return 0;
  }
  return turnMessageStore.updateWhere(
    { summarized: true },
    (messageItem) =>
      shouldMarkCurrentTurnSummarizedMessage(messageItem, { taskSummaryToolName }),
  );
}

export function markCurrentTurnArraySummarized(
  messages = [],
  { taskSummaryToolName = DEFAULT_TASK_SUMMARY_TOOL_NAME } = {},
) {
  const source = Array.isArray(messages) ? messages : [];
  return source.map((messageItem) => {
    if (
      !shouldMarkCurrentTurnSummarizedMessage(messageItem, {
        taskSummaryToolName,
      })
    ) {
      return messageItem;
    }
    return { ...(messageItem || {}), summarized: true };
  });
}

export function markCurrentTurnModelMessagesSummarized(
  messages = [],
  { taskSummaryToolName = DEFAULT_TASK_SUMMARY_TOOL_NAME } = {},
) {
  if (!Array.isArray(messages)) return;
  for (const messageItem of messages) {
    if (
      !shouldMarkCurrentTurnSummarizedModelMessage(messageItem, {
        taskSummaryToolName,
      })
    ) {
      continue;
    }
    messageItem.summarized = true;
    if (messageItem?.lc_kwargs && typeof messageItem.lc_kwargs === "object") {
      messageItem.lc_kwargs.summarized = true;
    }
  }
}

export function filterSummarizedMessages(messages = []) {
  return filterForModelContext(messages);
}
