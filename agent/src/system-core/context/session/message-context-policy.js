/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { resolveMessageDialogProcessId } from "./dialog-process-id-resolver.js";


const TASK_SUMMARY_TOOL_NAME = "task_summary";

function resolveToolNameFromToolCall(toolCall = {}) {
  if (!toolCall || typeof toolCall !== "object") return "";
  if (toolCall.name) return String(toolCall.name || "").trim();
  const fn = toolCall.function && typeof toolCall.function === "object" ? toolCall.function : {};
  return String(fn.name || "").trim();
}

function hasTaskSummaryToolCall(messageItem = {}) {
  return getMessageToolCalls(messageItem).some(
    (toolCall) => resolveToolNameFromToolCall(toolCall) === TASK_SUMMARY_TOOL_NAME,
  );
}

function isTaskSummaryToolMessage(messageItem = {}) {
  const explicitToolName = String(
    messageItem?.toolName ||
      messageItem?.tool_name ||
      messageItem?.lc_kwargs?.toolName ||
      messageItem?.lc_kwargs?.tool_name ||
      "",
  ).trim();
  if (explicitToolName === TASK_SUMMARY_TOOL_NAME) return true;
  try {
    const parsed = JSON.parse(
      String(messageItem?.content ?? messageItem?.lc_kwargs?.content ?? ""),
    );
    return String(parsed?.toolName || "").trim() === TASK_SUMMARY_TOOL_NAME;
  } catch {
    return false;
  }
}


function getMessageContent(messageItem = {}) {
  return String(messageItem?.content ?? messageItem?.lc_kwargs?.content ?? "");
}

function extractTaskSummaryText(messageItem = {}) {
  const rawContent = getMessageContent(messageItem).trim();
  if (!rawContent) return "";
  try {
    const parsed = JSON.parse(rawContent);
    const phaseSummary = String(
      parsed?.phaseSummary || parsed?.phase_summary || "",
    ).trim();
    if (phaseSummary) return phaseSummary;
    const summaryContent = String(
      parsed?.summaryContent || parsed?.summary_content || "",
    ).trim();
    if (summaryContent) return summaryContent;
    const summary = typeof parsed?.summary === "string"
      ? String(parsed.summary || "").trim()
      : "";
    if (summary) return summary;
  } catch {
    // fall through to raw content
  }
  return rawContent;
}

function buildTaskSummaryUserMessage(messageItem = {}) {
  const summaryText = extractTaskSummaryText(messageItem);
  const toolCallId = String(
    messageItem?.tool_call_id ??
      messageItem?.toolCallId ??
      messageItem?.lc_kwargs?.tool_call_id ??
      "",
  ).trim();
  const content = summaryText.startsWith("[阶段小结]")
    ? summaryText
    : `[阶段小结]\n${summaryText}`;
  const {
    tool_call_id: omittedToolCallId,
    toolCallId: omittedToolCallIdCamel,
    toolName: omittedToolName,
    tool_name: omittedToolNameSnake,
    tool_calls: omittedToolCalls,
    lc_kwargs: omittedLcKwargs,
    ...rest
  } = messageItem || {};
  void omittedToolCallId;
  void omittedToolCallIdCamel;
  void omittedToolName;
  void omittedToolNameSnake;
  void omittedToolCalls;
  void omittedLcKwargs;
  return {
    ...rest,
    role: "user",
    content,
    summarized: false,
    phaseSummaryMemory: true,
    recoveredFromUnpairedTaskSummary: true,
    ...(toolCallId ? { original_tool_call_id: toolCallId } : {}),
    additional_kwargs: {
      ...(messageItem?.additional_kwargs && typeof messageItem.additional_kwargs === "object"
        ? messageItem.additional_kwargs
        : {}),
      noobotInternalMessageType: "phase_summary_memory",
      recoveredFromUnpairedTaskSummary: true,
      ...(toolCallId ? { original_tool_call_id: toolCallId } : {}),
    },
  };
}

export function getMessageToolCalls(messageItem = {}) {
  if (Array.isArray(messageItem?.tool_calls)) return messageItem.tool_calls;
  if (Array.isArray(messageItem?.lc_kwargs?.tool_calls)) return messageItem.lc_kwargs.tool_calls;
  if (Array.isArray(messageItem?.additional_kwargs?.tool_calls)) {
    return messageItem.additional_kwargs.tool_calls;
  }
  return [];
}

export function resolveMessageRole(messageItem = {}) {
  const role = String(
    messageItem?.role || messageItem?.lc_kwargs?.role || "",
  )
    .trim()
    .toLowerCase();
  if (role) return role;
  const type = String(
    messageItem?.type ||
      messageItem?.lc_kwargs?.type ||
      (typeof messageItem?._getType === "function" ? messageItem._getType() : ""),
  )
    .trim()
    .toLowerCase();
  if (type === "ai") return "assistant";
  if (type === "human") return "user";
  if (type === "system") return "system";
  if (type === "tool") return "tool";
  return "";
}

export function isMessageSummarized(messageItem = {}) {
  if (!messageItem || typeof messageItem !== "object") return false;
  if (messageItem?.summarized === true) return true;
  if (messageItem?.lc_kwargs?.summarized === true) return true;
  return false;
}

export function isCurrentSystemContextMessage(messageItem = {}) {
  const marker = String(
    messageItem?.additional_kwargs?.noobotInternalMessageType ||
      messageItem?.lc_kwargs?.additional_kwargs?.noobotInternalMessageType ||
      messageItem?.metadata?.noobotInternalMessageType ||
      messageItem?.lc_kwargs?.metadata?.noobotInternalMessageType ||
      "",
  ).trim();
  return marker === "system_context";
}

export function isInjectedMessage(messageItem = {}) {
  if (!messageItem || typeof messageItem !== "object") return false;
  if (messageItem?.injectedMessage === true) return true;
  if (messageItem?.lc_kwargs?.injectedMessage === true) return true;
  if (String(messageItem?.injectedBy || "").trim()) return true;
  if (String(messageItem?.lc_kwargs?.injectedBy || "").trim()) return true;
  const content = String(
    messageItem?.content ?? messageItem?.lc_kwargs?.content ?? "",
  ).trim();
  if (
    content.startsWith("[来自harness外部模型输出/") ||
    content.startsWith("[Relay from harness external model/")
  ) {
    return true;
  }
  return false;
}

export function resolveInjectedMessageType(messageItem = {}) {
  if (!isInjectedMessage(messageItem)) return "";
  const explicitType = String(
    messageItem?.injectedMessageType ||
      messageItem?.injected_message_type ||
      messageItem?.lc_kwargs?.injectedMessageType ||
      messageItem?.lc_kwargs?.injected_message_type ||
      messageItem?.additional_kwargs?.injectedMessageType ||
      messageItem?.lc_kwargs?.additional_kwargs?.injectedMessageType ||
      "",
  ).trim();
  if (explicitType) return explicitType;
  const internalType = String(
    messageItem?.additional_kwargs?.noobotInternalMessageType ||
      messageItem?.lc_kwargs?.additional_kwargs?.noobotInternalMessageType ||
      messageItem?.metadata?.noobotInternalMessageType ||
      messageItem?.lc_kwargs?.metadata?.noobotInternalMessageType ||
      "",
  ).trim();
  if (internalType) return internalType;
  const content = String(
    messageItem?.content ?? messageItem?.lc_kwargs?.content ?? "",
  ).trim();
  const relayMatch = content.match(/^\[(?:来自harness外部模型输出|Relay from harness external model)\/([^\]]+)\]/);
  if (relayMatch?.[1]) return `harness_relay:${String(relayMatch[1] || "").trim()}`;
  const genericType = String(messageItem?.type || messageItem?.lc_kwargs?.type || "").trim();
  if (genericType && genericType !== "message") return genericType;
  const injectedBy = String(
    messageItem?.injectedBy || messageItem?.lc_kwargs?.injectedBy || "",
  ).trim();
  return injectedBy || "injected_message";
}

function buildInjectedMessageLatestKey(messageItem = {}) {
  const type = resolveInjectedMessageType(messageItem);
  if (!type) return "";
  const injectedBy = String(
    messageItem?.injectedBy || messageItem?.lc_kwargs?.injectedBy || "",
  ).trim();
  return `${injectedBy || "injected"}:${type}`;
}

export function collectLatestInjectedMessageIndexes(messages = []) {
  const latestByType = new Map();
  const source = Array.isArray(messages) ? messages : [];
  for (let index = 0; index < source.length; index += 1) {
    const key = buildInjectedMessageLatestKey(source[index]);
    if (!key) continue;
    latestByType.set(key, index);
  }
  return new Set(latestByType.values());
}

export function filterLatestInjectedMessagesByType(messages = []) {
  const source = Array.isArray(messages) ? messages : [];
  const latestIndexes = collectLatestInjectedMessageIndexes(source);
  return source.filter((messageItem, index) => {
    if (!isInjectedMessage(messageItem)) return true;
    const key = buildInjectedMessageLatestKey(messageItem);
    if (!key) return true;
    return latestIndexes.has(index);
  });
}

function shouldKeepMessageForDialog(
  messageItem = {},
  currentDialogProcessId = "",
) {
  if (!isInjectedMessage(messageItem)) return true;
  const normalizedCurrentDialogProcessId = String(
    currentDialogProcessId || "",
  ).trim();
  if (!normalizedCurrentDialogProcessId) return true;
  return (
    resolveMessageDialogProcessId(messageItem) ===
    normalizedCurrentDialogProcessId
  );
}

export function filterInjectedMessagesForDialog(
  messages = [],
  currentDialogProcessId = "",
) {
  const sameDialogMessages = (Array.isArray(messages) ? messages : []).filter((messageItem) =>
    shouldKeepMessageForDialog(messageItem, currentDialogProcessId),
  );
  return filterLatestInjectedMessagesByType(sameDialogMessages);
}

export function shouldKeepForModelContext(messageItem = {}) {
  if (
    isMessageSummarized(messageItem) &&
    resolveMessageRole(messageItem) === "system" &&
    isCurrentSystemContextMessage(messageItem)
  ) {
    return true;
  }
  return !isMessageSummarized(messageItem);
}

export function filterForModelContext(messages = []) {
  const source = filterLatestInjectedMessagesByType(
    (Array.isArray(messages) ? messages : []).filter((messageItem) =>
      shouldKeepForModelContext(messageItem),
    ),
  );
  const assistantCallIds = new Set();
  const toolResultIds = new Set();

  for (const messageItem of source) {
    const role = resolveMessageRole(messageItem);
    if (role === "assistant") {
      const toolCalls = getMessageToolCalls(messageItem);
      for (const toolCall of toolCalls) {
        const id = String(
          toolCall?.id ??
            toolCall?.tool_call_id ??
            toolCall?.toolCallId ??
            toolCall?.call_id ??
            "",
        ).trim();
        if (id) assistantCallIds.add(id);
      }
      continue;
    }
    if (role === "tool") {
      const id = String(
        messageItem?.tool_call_id ??
          messageItem?.toolCallId ??
          messageItem?.lc_kwargs?.tool_call_id ??
          "",
      ).trim();
      if (id) toolResultIds.add(id);
    }
  }

  const validPairIds = new Set(
    [...assistantCallIds].filter((id) => toolResultIds.has(id)),
  );

  const filteredMessages = [];
  for (const messageItem of source) {
    const role = resolveMessageRole(messageItem);
    if (role === "tool") {
      const id = String(
        messageItem?.tool_call_id ??
          messageItem?.toolCallId ??
          messageItem?.lc_kwargs?.tool_call_id ??
          "",
      ).trim();
      if (id && validPairIds.has(id)) {
        filteredMessages.push(messageItem);
        continue;
      }
      if (isTaskSummaryToolMessage(messageItem)) {
        filteredMessages.push(buildTaskSummaryUserMessage(messageItem));
      }
      continue;
    }
    if (role !== "assistant") {
      filteredMessages.push(messageItem);
      continue;
    }
    const toolCalls = getMessageToolCalls(messageItem);
    if (!toolCalls.length) {
      filteredMessages.push(messageItem);
      continue;
    }
    const ids = toolCalls
      .map((toolCall) =>
        String(
          toolCall?.id ??
            toolCall?.tool_call_id ??
            toolCall?.toolCallId ??
            toolCall?.call_id ??
            "",
        ).trim(),
      )
      .filter(Boolean);
    if (!ids.length) continue;
    if (ids.every((id) => validPairIds.has(id))) {
      filteredMessages.push(messageItem);
    }
  }
  return filteredMessages;
}

export function shouldMarkCurrentTurnSummarizedByPolicy(messageItem = {}) {
  const role = resolveMessageRole(messageItem);
  if (role === "user") return false;
  if (role === "assistant") return getMessageToolCalls(messageItem).length > 0;
  if (role === "tool" || role === "system") return true;
  return false;
}

export function shouldMarkCurrentTurnModelSummarizedByPolicy(messageItem = {}) {
  const role = resolveMessageRole(messageItem);
  if (role === "user") return false;
  if (role === "assistant") return getMessageToolCalls(messageItem).length > 0;
  if (role === "tool" || role === "system") return true;
  return false;
}
