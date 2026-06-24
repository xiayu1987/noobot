/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  collectLatestInjectedMessageIndexes,
  filterForModelContext,
  getMessageToolCalls,
  isInjectedMessage,
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

function getTaskSummaryToolCallIds(
  messageItem = {},
  { taskSummaryToolName = DEFAULT_TASK_SUMMARY_TOOL_NAME } = {},
) {
  return getMessageToolCalls(messageItem)
    .filter((toolCall) => {
      if (!toolCall || typeof toolCall !== "object") return false;
      const name = toolCall.name
        ? String(toolCall.name || "").trim()
        : String(toolCall.function?.name || "").trim();
      return name === taskSummaryToolName;
    })
    .map((toolCall) => String(toolCall.id || toolCall.tool_call_id || "").trim())
    .filter(Boolean);
}

export function isTaskSummaryToolMessage(
  messageItem = {},
  { taskSummaryToolName = DEFAULT_TASK_SUMMARY_TOOL_NAME } = {},
) {
  return resolveToolNameFromMessage(messageItem) === taskSummaryToolName;
}

function isTaskSummaryMessage(
  messageItem = {},
  { taskSummaryToolName = DEFAULT_TASK_SUMMARY_TOOL_NAME } = {},
) {
  return (
    hasTaskSummaryToolCall(messageItem, { taskSummaryToolName }) ||
    isTaskSummaryToolMessage(messageItem, { taskSummaryToolName })
  );
}

export function collectLatestTaskSummaryMessageIndexes(
  messages = [],
  { taskSummaryToolName = DEFAULT_TASK_SUMMARY_TOOL_NAME } = {},
) {
  const source = Array.isArray(messages) ? messages : [];
  const latestIndexes = new Set();
  for (let index = source.length - 1; index >= 0; index -= 1) {
    const messageItem = source[index];
    if (!isTaskSummaryMessage(messageItem, { taskSummaryToolName })) continue;
    latestIndexes.add(index);
    const toolCallId = String(messageItem?.tool_call_id || messageItem?.toolCallId || "").trim();
    if (isTaskSummaryToolMessage(messageItem, { taskSummaryToolName }) && toolCallId) {
      for (let prevIndex = index - 1; prevIndex >= 0; prevIndex -= 1) {
        const callIds = getTaskSummaryToolCallIds(source[prevIndex], {
          taskSummaryToolName,
        });
        if (!callIds.includes(toolCallId)) continue;
        latestIndexes.add(prevIndex);
        break;
      }
    }
    break;
  }
  return latestIndexes;
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

function shouldPreserveInjectedMessageAtIndex(
  messages = [],
  index = -1,
  latestInjectedIndexes = null,
) {
  if (!Array.isArray(messages) || index < 0) return false;
  const messageItem = messages[index];
  if (!isInjectedMessage(messageItem)) return false;
  const latestIndexes =
    latestInjectedIndexes instanceof Set
      ? latestInjectedIndexes
      : collectLatestInjectedMessageIndexes(messages);
  return latestIndexes.has(index);
}

function shouldMarkCurrentTurnSummarizedMessageInScope(
  messageItem = {},
  {
    messages = [],
    index = -1,
    latestInjectedIndexes = null,
    latestTaskSummaryIndexes = null,
    taskSummaryToolName = DEFAULT_TASK_SUMMARY_TOOL_NAME,
  } = {},
) {
  if (shouldPreserveInjectedMessageAtIndex(messages, index, latestInjectedIndexes)) return false;
  if (isInjectedMessage(messageItem)) return true;
  if (isTaskSummaryMessage(messageItem, { taskSummaryToolName })) {
    const latestIndexes =
      latestTaskSummaryIndexes instanceof Set
        ? latestTaskSummaryIndexes
        : collectLatestTaskSummaryMessageIndexes(messages, { taskSummaryToolName });
    if (latestIndexes.has(index)) return false;
    return shouldMarkCurrentTurnSummarizedByPolicy(messageItem);
  }
  return shouldMarkCurrentTurnSummarizedMessage(messageItem, { taskSummaryToolName });
}

export function markCurrentTurnStoreSummarized(
  turnMessageStore = null,
  { taskSummaryToolName = DEFAULT_TASK_SUMMARY_TOOL_NAME } = {},
) {
  if (!turnMessageStore || typeof turnMessageStore.updateWhere !== "function") {
    return 0;
  }
  const scopedMessages =
    typeof turnMessageStore.toArray === "function" ? turnMessageStore.toArray() : [];
  const latestInjectedIndexes = collectLatestInjectedMessageIndexes(scopedMessages);
  const latestTaskSummaryIndexes = collectLatestTaskSummaryMessageIndexes(scopedMessages, {
    taskSummaryToolName,
  });
  return turnMessageStore.updateWhere(
    { summarized: true },
    (messageItem, index) =>
      shouldMarkCurrentTurnSummarizedMessageInScope(messageItem, {
        messages: scopedMessages,
        index,
        latestInjectedIndexes,
        latestTaskSummaryIndexes,
        taskSummaryToolName,
      }),
  );
}

export function markCurrentTurnArraySummarized(
  messages = [],
  { taskSummaryToolName = DEFAULT_TASK_SUMMARY_TOOL_NAME } = {},
) {
  const source = Array.isArray(messages) ? messages : [];
  const latestInjectedIndexes = collectLatestInjectedMessageIndexes(source);
  const latestTaskSummaryIndexes = collectLatestTaskSummaryMessageIndexes(source, {
    taskSummaryToolName,
  });
  return source.map((messageItem, index) => {
    if (
      !shouldMarkCurrentTurnSummarizedMessageInScope(messageItem, {
        messages: source,
        index,
        latestInjectedIndexes,
        latestTaskSummaryIndexes,
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
  const latestTaskSummaryIndexes = collectLatestTaskSummaryMessageIndexes(messages, {
    taskSummaryToolName,
  });
  for (const [index, messageItem] of messages.entries()) {
    if (isTaskSummaryMessage(messageItem, { taskSummaryToolName })) {
      if (latestTaskSummaryIndexes.has(index)) continue;
      if (!shouldMarkCurrentTurnModelSummarizedByPolicy(messageItem)) continue;
    } else if (
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
