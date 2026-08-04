/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { emitEvent } from "../events/index.js";

export const CONTEXT_IDENTITY_DEBUG_TYPE = "context-identity";

export function canonicalMessageId(message = {}) {
  return String(
    message?.messageUid
      || message?.messageId
      || message?.id
      || message?.additional_kwargs?.noobotMessageId
      || "",
  ).trim();
}

function messageField(message = {}, field = "") {
  return String(
    message?.[field] ||
      message?.additional_kwargs?.[field] ||
      message?.lc_kwargs?.additional_kwargs?.[field] ||
      "",
  ).trim();
}

export function canonicalMessageIdentityDebugData(message = {}, meta = {}) {
  const rawRole = String(
    message?.role ||
      message?.type ||
      (typeof message?._getType === "function" ? message._getType() : "") ||
      "",
  ).trim().toLowerCase();
  const role = rawRole === "ai" ? "assistant" : rawRole === "human" ? "user" : rawRole;
  const toolCalls = Array.isArray(message?.tool_calls)
    ? message.tool_calls
    : Array.isArray(message?.lc_kwargs?.tool_calls)
      ? message.lc_kwargs.tool_calls
      : [];
  return {
    messageId: canonicalMessageId(message),
    role,
    operation: String(meta?.operation || "").trim(),
    block: String(meta?.block || "").trim(),
    messageDialogProcessId: messageField(message, "dialogProcessId"),
    messageTurnScopeId: messageField(message, "turnScopeId"),
    toolCallId: messageField(message, "tool_call_id") || messageField(message, "toolCallId"),
    toolCallCount: toolCalls.length,
    internalType: messageField(message, "noobotInternalMessageType"),
    injectedMessageType: messageField(message, "injectedMessageType"),
  };
}

export function emitContextIdentityDebug(eventListener, event, identity = {}, data = {}) {
  emitEvent(eventListener, `agent.contextIdentity.${String(event || "observed").trim()}`, {
    ...(data && typeof data === "object" ? data : {}),
    debugType: CONTEXT_IDENTITY_DEBUG_TYPE,
    userId: String(identity?.userId || "").trim(),
    sessionId: String(identity?.sessionId || "").trim(),
    parentSessionId: String(identity?.parentSessionId || "").trim(),
    dialogProcessId: String(identity?.dialogProcessId || "").trim(),
    turnScopeId: String(identity?.turnScopeId || "").trim(),
  });
}
