/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  getMessageRuntimeChannelState,
  SESSION_RUN_MESSAGE_RUNTIME_MARK,
} from "../../chat/runtime/sessionRunStateMachine.js";
import { acceptsDebugSink, emitLazyDebug, isDebugTypeEnabled } from "./lazyDebugSink.js";

let sessionLogSink = null;

export function setStateMachineDebugLogSink(sink = null) {
  sessionLogSink = acceptsDebugSink(sink) ? sink : null;
}

export function isStateMachineDebugEnabled() {
  return isDebugTypeEnabled(sessionLogSink, "state-machine");
}

export function summarizeStateMachineMessage(message = {}) {
  if (!message || typeof message !== "object") return null;
  const channelState = getMessageRuntimeChannelState(message);
  return {
    id: message.id || message.messageId || "",
    role: message.role || message.messageRole || message.type || "",
    sessionId: message.sessionId || message.session_id || message.owner?.sessionId || "",
    dialogProcessId: message.dialogProcessId || message.dialog_process_id || message.owner?.dialogProcessId || "",
    turnScopeId: message.turnScopeId || message.owner?.turnScopeId || "",
    pending: message.pending === true,
    channelState: channelState?.state || "",
    statusLabelKey: message.statusLabelKey || "",
    statusLabel: message.statusLabel || "",
    hasRuntimeMark: Boolean(message[SESSION_RUN_MESSAGE_RUNTIME_MARK] || message.runtimeMark),
    contentLength: String(message.content || message.text || message.message || "").length,
  };
}

export function logStateMachineDebug(event, payload = {}) {
  try {
    return emitLazyDebug(sessionLogSink, "state-machine", event, payload);
  } catch {}
}
