/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  filterForModelContext as filterForModelContextProtocol,
  getMessageToolCalls,
  isCurrentSystemContextMessage,
  isInjectedMessage as isInjectedMessageProtocol,
  isMessageSummarized,
  isSystemLikeMessageRole,
  resolveInjectedMessageType as resolveInjectedMessageTypeProtocol,
  resolveMessageRole,
  shouldKeepForModelContext,
  shouldMarkCurrentTurnSummarizedByPolicy,
} from "@noobot/context-protocol/message-policy";

const TASK_SUMMARY_TOOL_NAME = "task_summary";

function resolveToolNameFromToolCall(toolCall = {}) {
  if (!toolCall || typeof toolCall !== "object") return "";
  if (toolCall.name) return String(toolCall.name || "").trim();
  return String(toolCall?.function?.name || "").trim();
}

function isTaskSummaryToolMessage(message = {}) {
  const explicit = String(
    message?.toolName || message?.tool_name || message?.lc_kwargs?.toolName ||
      message?.lc_kwargs?.tool_name || "",
  ).trim();
  if (explicit === TASK_SUMMARY_TOOL_NAME) return true;
  try {
    const parsed = JSON.parse(String(message?.content ?? message?.lc_kwargs?.content ?? ""));
    return String(parsed?.toolName || "").trim() === TASK_SUMMARY_TOOL_NAME;
  } catch {
    return false;
  }
}

function extractTaskSummaryText(message = {}) {
  const raw = String(message?.content ?? message?.lc_kwargs?.content ?? "").trim();
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    return String(
      parsed?.phaseSummary || parsed?.phase_summary || parsed?.summaryContent ||
        parsed?.summary_content || (typeof parsed?.summary === "string" ? parsed.summary : "") || raw,
    ).trim();
  } catch {
    return raw;
  }
}

function recoverTaskSummaryToolResult(message = {}) {
  if (!isTaskSummaryToolMessage(message)) return null;
  const summary = extractTaskSummaryText(message);
  const toolCallId = String(
    message?.tool_call_id ?? message?.toolCallId ?? message?.lc_kwargs?.tool_call_id ?? "",
  ).trim();
  const {
    tool_call_id: omittedToolCallId,
    toolCallId: omittedToolCallIdCamel,
    toolName: omittedToolName,
    tool_name: omittedToolNameSnake,
    tool_calls: omittedToolCalls,
    lc_kwargs: omittedLcKwargs,
    ...rest
  } = message || {};
  void omittedToolCallId;
  void omittedToolCallIdCamel;
  void omittedToolName;
  void omittedToolNameSnake;
  void omittedToolCalls;
  void omittedLcKwargs;
  return {
    ...rest,
    role: "user",
    content: summary.startsWith("[阶段小结]") ? summary : `[阶段小结]\n${summary}`,
    summarized: false,
    phaseSummaryMemory: true,
    recoveredFromUnpairedTaskSummary: true,
    ...(toolCallId ? { original_tool_call_id: toolCallId } : {}),
    additional_kwargs: {
      ...(message?.additional_kwargs && typeof message.additional_kwargs === "object"
        ? message.additional_kwargs
        : {}),
      noobotInternalMessageType: "phase_summary_memory",
      recoveredFromUnpairedTaskSummary: true,
      ...(toolCallId ? { original_tool_call_id: toolCallId } : {}),
    },
  };
}

export const AGENT_MODEL_CONTEXT_POLICY_OPTIONS = Object.freeze({
  recoverUnpairedToolResult: recoverTaskSummaryToolResult,
});

export {
  getMessageToolCalls,
  isCurrentSystemContextMessage,
  isMessageSummarized,
  isSystemLikeMessageRole,
  resolveMessageRole,
  shouldKeepForModelContext,
  shouldMarkCurrentTurnSummarizedByPolicy,
};

export function isInjectedMessage(message = {}) {
  return isInjectedMessageProtocol(message, AGENT_MODEL_CONTEXT_POLICY_OPTIONS);
}

export function resolveInjectedMessageType(message = {}) {
  return resolveInjectedMessageTypeProtocol(message, AGENT_MODEL_CONTEXT_POLICY_OPTIONS);
}

export function filterForModelContext(messages = [], options = {}) {
  return filterForModelContextProtocol(messages, {
    ...AGENT_MODEL_CONTEXT_POLICY_OPTIONS,
    ...options,
  });
}

export function hasTaskSummaryToolCall(message = {}) {
  return getMessageToolCalls(message).some(
    (toolCall) => resolveToolNameFromToolCall(toolCall) === TASK_SUMMARY_TOOL_NAME,
  );
}
