/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const DEFAULT_TASK_SUMMARY_TOOL_NAME = "task_summary";

function normalizeAiTextContent(aiContent) {
  if (typeof aiContent === "string") return String(aiContent || "");
  if (!Array.isArray(aiContent)) return String(aiContent || "");
  const textParts = aiContent
    .map((contentPart) => {
      if (!contentPart || typeof contentPart !== "object") return "";
      if (typeof contentPart?.text === "string") return contentPart.text;
      if (typeof contentPart?.content === "string") return contentPart.content;
      return "";
    })
    .filter(Boolean);
  return textParts.join("\n");
}

export function getMessageRole(messageItem = {}) {
  return String(messageItem?.role || "").trim();
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
  const role = getMessageRole(messageItem);
  if (role === "tool") {
    return !isTaskSummaryToolMessage(messageItem, { taskSummaryToolName });
  }
  if (role !== "assistant") return false;
  return !String(messageItem?.content || "").trim();
}

export function shouldMarkCurrentTurnSummarizedModelMessage(
  messageItem = {},
  { taskSummaryToolName = DEFAULT_TASK_SUMMARY_TOOL_NAME } = {},
) {
  const type = getModelMessageType(messageItem);
  if (type === "tool") {
    return !isTaskSummaryToolMessage(messageItem, { taskSummaryToolName });
  }
  if (type !== "ai") return false;
  return !normalizeAiTextContent(messageItem?.content);
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
  if (!Array.isArray(messages)) return [];
  return messages.filter((messageItem) => {
    if (!messageItem || typeof messageItem !== "object") return true;
    if (messageItem?.summarized === true) return false;
    if (messageItem?.lc_kwargs?.summarized === true) return false;
    return true;
  });
}
