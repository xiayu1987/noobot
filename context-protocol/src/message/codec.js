/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

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

export const CONTEXT_MESSAGE_ROLE_ALIASES = Object.freeze({
  system: CONTEXT_MESSAGE_ROLE.SYSTEM,
  developer: CONTEXT_MESSAGE_ROLE.SYSTEM,
  user: CONTEXT_MESSAGE_ROLE.USER,
  human: CONTEXT_MESSAGE_ROLE.USER,
  assistant: CONTEXT_MESSAGE_ROLE.ASSISTANT,
  ai: CONTEXT_MESSAGE_ROLE.ASSISTANT,
  tool: CONTEXT_MESSAGE_ROLE.TOOL,
  tool_result: CONTEXT_MESSAGE_ROLE.TOOL,
});

/**
 * Reads the declared role field verbatim without alias normalization.
 * Callers that must distinguish "declared but unknown" from "absent"
 * (protocol required-field validation) depend on this raw form.
 */
export function readDeclaredContextMessageRole(message = {}) {
  return text(message?.role || message?.lc_kwargs?.role).toLowerCase();
}

function readDeclaredContextMessageType(message = {}) {
  return text(
    message?.type ||
      message?.lc_kwargs?.type ||
      (typeof message?._getType === "function" ? message._getType() : ""),
  ).toLowerCase();
}

/** Maps any declared role or type token onto the canonical role vocabulary. */
export function normalizeContextMessageRole(role = "") {
  return CONTEXT_MESSAGE_ROLE_ALIASES[text(role).toLowerCase()] || "";
}

export function resolveContextMessageRole(message = {}) {
  return (
    normalizeContextMessageRole(readDeclaredContextMessageRole(message)) ||
    normalizeContextMessageRole(readDeclaredContextMessageType(message))
  );
}

/** Single decision point for "does this message belong to the system block". */
export function isContextSystemMessage(message = {}) {
  return resolveContextMessageRole(message) === CONTEXT_MESSAGE_ROLE.SYSTEM;
}

export function resolveContextMessageId(message = {}) {
  return text(message?.messageUid || readContextMessageField(message, "noobotMessageId"));
}

export function deriveContextMessageProjectionId(sourceMessageId = "", projectionType = "") {
  const sourceId = text(sourceMessageId);
  const type = text(projectionType);
  return sourceId && type ? `${sourceId}::${type}` : "";
}

export function resolveContextMessageDialogProcessId(message = {}) {
  return readContextMessageField(message, "dialogProcessId");
}

export function resolveContextMessageOrigin(message = {}) {
  return readContextMessageField(message, "messageOrigin").toLowerCase();
}

export function resolveContextUserMetaMaterialized(message = {}) {
  return (
    message?.userMetaMaterialized === true ||
    message?.additional_kwargs?.userMetaMaterialized === true ||
    message?.lc_kwargs?.userMetaMaterialized === true ||
    message?.lc_kwargs?.additional_kwargs?.userMetaMaterialized === true
  );
}

export function resolveContextMessageTurnScopeId(message = {}) {
  return readContextMessageField(message, "turnScopeId");
}

export function resolveContextMessageContent(message = {}) {
  const content = message?.content ?? message?.lc_kwargs?.content ?? "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (typeof item === "string") return item;
      if (!item || typeof item !== "object") return "";
      return String(item.text ?? item.content ?? item.value ?? "");
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function resolveContextToolCalls(message = {}) {
  if (Array.isArray(message?.tool_calls)) return message.tool_calls;
  if (Array.isArray(message?.lc_kwargs?.tool_calls)) return message.lc_kwargs.tool_calls;
  if (Array.isArray(message?.additional_kwargs?.tool_calls))
    return message.additional_kwargs.tool_calls;
  return [];
}

export function resolveContextToolCallId(value = {}) {
  return text(
    value?.tool_call_id ??
      value?.toolCallId ??
      value?.call_id ??
      value?.lc_kwargs?.tool_call_id ??
      value?.lc_kwargs?.toolCallId ??
      value?.id ??
      "",
  );
}

/** Single read point for the summarized mark across all four carrier paths. */
export function resolveContextMessageSummarized(message = {}) {
  return (
    message?.summarized === true ||
    message?.lc_kwargs?.summarized === true ||
    message?.additional_kwargs?.summarized === true ||
    message?.lc_kwargs?.additional_kwargs?.summarized === true
  );
}

/** Single write point for the summarized mark; mirrors onto lc_kwargs when present. */
export function markContextMessageSummarized(message = {}) {
  if (!message || typeof message !== "object") return message;
  message.summarized = true;
  if (message.lc_kwargs && typeof message.lc_kwargs === "object") {
    message.lc_kwargs.summarized = true;
  }
  return message;
}

export function resolveContextMessageFlags(message = {}) {
  return {
    summarized: resolveContextMessageSummarized(message),
    naturalUser: resolveContextMessageOrigin(message) === "natural",
    injected:
      readContextMessageField(message, "injectedMessage").toLowerCase() === "true" ||
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

export function projectContextMessageIdentityMetadata(message = {}) {
  const noobotMessageId = resolveContextMessageId(message);
  const dialogProcessId = resolveContextMessageDialogProcessId(message);
  const turnScopeId = resolveContextMessageTurnScopeId(message);
  const parentDialogProcessId = readContextMessageField(message, "parentDialogProcessId");
  const injectedBy = readContextMessageField(message, "injectedBy");
  const injectedMessageType = readContextMessageField(message, "injectedMessageType");
  const messageOrigin = readContextMessageField(message, "messageOrigin");
  const userMetaMaterialized = resolveContextUserMetaMaterialized(message);
  return {
    ...(noobotMessageId ? { noobotMessageId } : {}),
    ...(dialogProcessId ? { dialogProcessId } : {}),
    ...(parentDialogProcessId ? { parentDialogProcessId } : {}),
    ...(turnScopeId ? { turnScopeId } : {}),
    ...(messageOrigin ? { messageOrigin } : {}),
    ...(userMetaMaterialized ? { userMetaMaterialized: true } : {}),
    ...(message?.injectedMessage === true ? { injectedMessage: true } : {}),
    ...(injectedBy ? { injectedBy } : {}),
    ...(injectedMessageType ? { injectedMessageType } : {}),
    ...(message?.pluginMessage === true ? { pluginMessage: true } : {}),
  };
}
