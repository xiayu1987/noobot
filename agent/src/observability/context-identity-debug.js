/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { emitEvent } from "../events/index.js";
import { text } from "@noobot/shared/value";
import {
  inspectContextMessageIdentity,
  readContextMessageField,
} from "@noobot/context-protocol/message/codec";

function messageField(message = {}, field = "") {
  return text(message?.[field]) || readContextMessageField(message, field);
}

export function canonicalMessageIdentityDebugData(message = {}, meta = {}) {
  const rawRole = text(message?.role || message?.type).toLowerCase();
  const role = rawRole === "ai" ? "assistant" : rawRole === "human" ? "user" : rawRole;
  const toolCalls = Array.isArray(message?.tool_calls)
    ? message.tool_calls
    : Array.isArray(message?.lc_kwargs?.tool_calls)
      ? message.lc_kwargs.tool_calls
      : [];
  const identity = inspectContextMessageIdentity(message);
  return {
    messageKey: identity.key,
    identityShape: identity.shape,
    identityFields: identity.fields,
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
  emitEvent(eventListener, `agent.contextIdentity.${text(event) || "observed"}`, data);
}
