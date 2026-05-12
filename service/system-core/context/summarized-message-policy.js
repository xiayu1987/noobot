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

function getMessageToolCalls(messageItem = {}) {
  if (Array.isArray(messageItem?.tool_calls)) return messageItem.tool_calls;
  if (Array.isArray(messageItem?.lc_kwargs?.tool_calls)) {
    return messageItem.lc_kwargs.tool_calls;
  }
  if (Array.isArray(messageItem?.additional_kwargs?.tool_calls)) {
    return messageItem.additional_kwargs.tool_calls;
  }
  return [];
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
  const role = getMessageRole(messageItem);
  if (role === "tool") {
    return !isTaskSummaryToolMessage(messageItem, { taskSummaryToolName });
  }
  if (role !== "assistant") return false;
  if (hasTaskSummaryToolCall(messageItem, { taskSummaryToolName })) {
    return false;
  }
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
  if (hasTaskSummaryToolCall(messageItem, { taskSummaryToolName })) {
    return false;
  }
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
  const baseFiltered = messages.filter((messageItem) => {
    if (!messageItem || typeof messageItem !== "object") return true;
    if (messageItem?.summarized === true) return false;
    if (messageItem?.lc_kwargs?.summarized === true) return false;
    return true;
  });

  const remainingToolResultIds = new Set();
  for (const messageItem of baseFiltered) {
    const modelType = getModelMessageType(messageItem);
    const role = getMessageRole(messageItem);
    const isToolMessage = modelType === "tool" || role === "tool";
    if (!isToolMessage) continue;
    const toolCallId = String(
      messageItem?.tool_call_id ??
        messageItem?.toolCallId ??
        messageItem?.lc_kwargs?.tool_call_id ??
        "",
    ).trim();
    if (toolCallId) remainingToolResultIds.add(toolCallId);
  }

  return baseFiltered.filter((messageItem) => {
    if (!messageItem || typeof messageItem !== "object") return true;
    const toolCalls = getMessageToolCalls(messageItem);
    if (!Array.isArray(toolCalls) || !toolCalls.length) return true;
    const toolCallIds = toolCalls
      .map((toolCall) =>
        String(
          toolCall?.id ??
            toolCall?.tool_call_id ??
            toolCall?.toolCallId ??
            "",
        ).trim(),
      )
      .filter(Boolean);
    if (!toolCallIds.length) return true;
    return toolCallIds.every((toolCallId) =>
      remainingToolResultIds.has(toolCallId),
    );
  });
}
