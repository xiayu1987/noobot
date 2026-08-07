/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  TASK_SUMMARY_PROTOCOL_VERSION,
  parseTaskSummaryReceipt,
} from "./task-summary-protocol.js";

const text = (value) => String(value ?? "").trim();

export const CONTEXT_MESSAGE_ROLE = Object.freeze({
  SYSTEM: "system",
  USER: "user",
  ASSISTANT: "assistant",
  TOOL: "tool",
});

export function readContextMessageField(message = {}, field = "") {
  const key = text(field);
  if (!key || !message || typeof message !== "object") return "";
  return text(
    message?.[key] ??
      message?.additional_kwargs?.[key] ??
      message?.lc_kwargs?.[key] ??
      message?.lc_kwargs?.additional_kwargs?.[key] ??
      "",
  );
}

export function resolveContextMessageRole(message = {}) {
  const role = text(message?.role || message?.lc_kwargs?.role).toLowerCase();
  if (["system", "developer"].includes(role)) return CONTEXT_MESSAGE_ROLE.SYSTEM;
  if (["user", "human"].includes(role)) return CONTEXT_MESSAGE_ROLE.USER;
  if (["assistant", "ai"].includes(role)) return CONTEXT_MESSAGE_ROLE.ASSISTANT;
  if (["tool", "tool_result"].includes(role)) return CONTEXT_MESSAGE_ROLE.TOOL;
  const type = text(
    message?.type || message?.lc_kwargs?.type ||
      (typeof message?._getType === "function" ? message._getType() : ""),
  ).toLowerCase();
  return ({
    system: CONTEXT_MESSAGE_ROLE.SYSTEM,
    developer: CONTEXT_MESSAGE_ROLE.SYSTEM,
    human: CONTEXT_MESSAGE_ROLE.USER,
    user: CONTEXT_MESSAGE_ROLE.USER,
    ai: CONTEXT_MESSAGE_ROLE.ASSISTANT,
    assistant: CONTEXT_MESSAGE_ROLE.ASSISTANT,
    tool: CONTEXT_MESSAGE_ROLE.TOOL,
    tool_result: CONTEXT_MESSAGE_ROLE.TOOL,
  })[type] || "";
}

export function resolveContextMessageId(message = {}) {
  return text(
    message?.messageUid ||
      readContextMessageField(message, "noobotMessageId"),
  );
}

export function deriveContextMessageProjectionId(sourceMessageId = "", projectionType = "") {
  const sourceId = text(sourceMessageId);
  const type = text(projectionType);
  return sourceId && type ? `${sourceId}::${type}` : "";
}

export function resolveContextMessageDialogProcessId(message = {}) {
  return readContextMessageField(message, "dialogProcessId");
}

export function resolveContextMessageTurnScopeId(message = {}) {
  return readContextMessageField(message, "turnScopeId");
}

export function resolveContextMessageContent(message = {}) {
  const content = message?.content ?? message?.lc_kwargs?.content ?? "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((item) => {
    if (typeof item === "string") return item;
    if (!item || typeof item !== "object") return "";
    return String(item.text ?? item.content ?? item.value ?? "");
  }).filter(Boolean).join("\n").trim();
}

export function resolveContextToolCalls(message = {}) {
  if (Array.isArray(message?.tool_calls)) return message.tool_calls;
  if (Array.isArray(message?.lc_kwargs?.tool_calls)) return message.lc_kwargs.tool_calls;
  if (Array.isArray(message?.additional_kwargs?.tool_calls)) return message.additional_kwargs.tool_calls;
  return [];
}

export function resolveContextToolCallId(value = {}) {
  return text(
    value?.id ?? value?.tool_call_id ?? value?.toolCallId ?? value?.call_id ??
      value?.lc_kwargs?.tool_call_id ?? value?.lc_kwargs?.toolCallId ?? "",
  );
}

export function resolveContextToolName(value = {}) {
  const explicit = text(value?.name || value?.function?.name || value?.toolName || value?.tool_name);
  if (explicit) return explicit;
  try {
    return text(JSON.parse(resolveContextMessageContent(value))?.toolName);
  } catch {
    return "";
  }
}

export function extractContextTaskSummary(message = {}) {
  const raw = resolveContextMessageContent(message).trim();
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.protocolVersion !== TASK_SUMMARY_PROTOCOL_VERSION) return "";
    parseTaskSummaryReceipt(parsed?.summary);
    return raw;
  } catch {
    return "";
  }
}

export function recoverContextTaskSummaryToolResult(message = {}, { toolName = "task_summary" } = {}) {
  if (resolveContextMessageRole(message) !== CONTEXT_MESSAGE_ROLE.TOOL) return null;
  if (resolveContextToolName(message) !== toolName) return null;
  const summary = extractContextTaskSummary(message);
  if (!summary) return null;
  const sourceMessageId = resolveContextMessageId(message);
  const toolCallId = resolveContextToolCallId(message);
  const {
    tool_call_id: omittedToolCallId,
    toolCallId: omittedToolCallIdCamel,
    toolName: omittedToolName,
    tool_name: omittedToolNameSnake,
    tool_calls: omittedToolCalls,
    ...rest
  } = message;
  void omittedToolCallId;
  void omittedToolCallIdCamel;
  void omittedToolName;
  void omittedToolNameSnake;
  void omittedToolCalls;
  return {
    ...rest,
    role: CONTEXT_MESSAGE_ROLE.USER,
    content: summary,
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
    projection: {
      type: "phase-summary",
      sourceMessageId,
    },
    data: { summary },
  };
}

export function resolveContextMessageFlags(message = {}) {
  return {
    summarized: message?.summarized === true || message?.lc_kwargs?.summarized === true ||
      message?.additional_kwargs?.summarized === true ||
      message?.lc_kwargs?.additional_kwargs?.summarized === true,
    frontendUser: message?.frontendUserMessage === true ||
      message?.additional_kwargs?.frontendUserMessage === true ||
      message?.lc_kwargs?.frontendUserMessage === true ||
      message?.lc_kwargs?.additional_kwargs?.frontendUserMessage === true,
    injected: readContextMessageField(message, "injectedMessage").toLowerCase() === "true" ||
      Boolean(readContextMessageField(message, "injectedBy")),
  };
}

export function contextMessageIdentityKey(message = {}) {
  const messageId = resolveContextMessageId(message);
  if (messageId) return `message:${messageId}`;
  const dialogProcessId = resolveContextMessageDialogProcessId(message);
  const turnScopeId = resolveContextMessageTurnScopeId(message);
  return dialogProcessId && turnScopeId ? `round:${dialogProcessId}\u0000${turnScopeId}` : "";
}
