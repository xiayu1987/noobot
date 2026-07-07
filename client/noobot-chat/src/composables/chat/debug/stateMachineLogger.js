/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const SESSION_RUN_MESSAGE_RUNTIME_MARK = "__noobotRuntimeRunStateKey";
let sessionLogSink = null;

export function setStateMachineDebugLogSink(sink = null) {
  sessionLogSink = sink && typeof sink.log === "function" ? sink : null;
}

export function isStateMachineDebugEnabled() {
  return true;
}

export function summarizeStateMachineMessage(message = {}) {
  if (!message || typeof message !== "object") return null;
  const channelState = message.channelState || message.channel_state || {};
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
    const entry = {
      event,
      at: new Date().toISOString(),
      ...payload,
    };
    sessionLogSink?.log?.({
      category: "debug",
      debugType: "state-machine",
      event,
      sessionId: payload?.sessionId || "",
      dialogProcessId: payload?.dialogProcessId || "",
      turnScopeId: payload?.turnScopeId || "",
      data: entry,
    });
  } catch {}
}
