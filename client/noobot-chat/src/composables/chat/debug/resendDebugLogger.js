/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

let sessionLogSink = null;

export function setResendDebugLogSink(sink = null) {
  sessionLogSink = sink && typeof sink.log === "function" ? sink : null;
}

function isBrowserDebugEnabled() {
  try {
    const params = new URLSearchParams(globalThis?.location?.search || "");
    if (["1", "true", "yes", "on"].includes(String(params.get("noobotResendDebug") || "").toLowerCase())) {
      return true;
    }
  } catch {}
  try {
    const value = globalThis?.localStorage?.getItem?.("noobotResendDebug");
    if (["1", "true", "yes", "on"].includes(String(value || "").toLowerCase())) return true;
  } catch {}
  return false;
}

export function isResendDebugEnabled() {
  try {
    if (import.meta.env?.VITE_NOOBOT_RESEND_DEBUG === "1" || import.meta.env?.VITE_NOOBOT_RESEND_DEBUG === "true") {
      return true;
    }
  } catch {}
  return isBrowserDebugEnabled();
}

export function summarizeDebugMessage(message = {}) {
  if (!message || typeof message !== "object") return null;
  const channelState = message.channelState || message.channel_state || {};
  return {
    id: message.id || message.messageId || "",
    role: message.role || message.messageRole || message.type || "",
    turnScopeId: message.turnScopeId || message.owner?.turnScopeId || "",
    dialogProcessId: message.dialogProcessId || message.dialog_process_id || message.owner?.dialogProcessId || "",
    parentDialogProcessId: message.parentDialogProcessId || message.parent_dialog_process_id || "",
    pending: message.pending === true,
    statusLabel: message.statusLabel || "",
    stopState: message.stopState || "",
    status: message.status || "",
    state: message.state || "",
    channelState: channelState?.state || "",
    contentLength: String(message.content || message.text || message.message || "").length,
  };
}

export function summarizeDebugMessages(messages = [], limit = 12) {
  if (!Array.isArray(messages)) return [];
  const start = Math.max(0, messages.length - limit);
  return messages.slice(start).map((message, offset) => ({
    index: start + offset,
    ...summarizeDebugMessage(message),
  }));
}

export function logResendDebug(phase, payload = {}) {
  if (!isResendDebugEnabled()) return;
  try {
    const entry = {
      phase,
      at: new Date().toISOString(),
      ...payload,
    };
    sessionLogSink?.log?.({
      category: "debug",
      event: phase,
      sessionId: payload?.sessionId || "",
      dialogProcessId: payload?.dialogProcessId || "",
      turnScopeId: payload?.turnScopeId || "",
      data: entry,
    });
  } catch {}
}
