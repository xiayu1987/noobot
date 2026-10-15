/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { emitEvent } from "../events/index.js";
import { text } from "@noobot/shared/value";

export function canonicalMessageId(message = {}) {
  return text(
    message?.messageUid || message?.messageId || message?.additional_kwargs?.noobotMessageId,
  );
}

function messageField(message = {}, field = "") {
  return text(
    message?.[field] ||
      message?.additional_kwargs?.[field] ||
      message?.lc_kwargs?.additional_kwargs?.[field],
  );
}

export function canonicalMessageIdentityDebugData(message = {}, meta = {}) {
  const rawRole = text(message?.role || message?.type).toLowerCase();
  const role = rawRole === "ai" ? "assistant" : rawRole === "human" ? "user" : rawRole;
  const toolCalls = Array.isArray(message?.tool_calls)
    ? message.tool_calls
    : Array.isArray(message?.lc_kwargs?.tool_calls)
      ? message.lc_kwargs.tool_calls
      : [];
  return {
    messageId: canonicalMessageId(message),
    role,
    operation: text(meta?.operation),
    block: text(meta?.block),
    messageDialogProcessId: messageField(message, "dialogProcessId"),
    messageTurnScopeId: messageField(message, "turnScopeId"),
    toolCallId: messageField(message, "tool_call_id") || messageField(message, "toolCallId"),
    toolCallCount: toolCalls.length,
    internalType: messageField(message, "noobotInternalMessageType"),
    injectedMessageType: messageField(message, "injectedMessageType"),
  };
}

export function emitContextIdentityDebug(eventListener, event, data = {}) {
  emitEvent(eventListener, `agent.contextIdentity.${String(event || "observed").trim()}`, data);
}
