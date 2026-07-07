/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

let sessionLogSink = null;

export function setResendDebugLogSink(sink = null) {
  sessionLogSink = sink && typeof sink.log === "function" ? sink : null;
}

export function isResendDebugEnabled() {
  return true;
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
    attachments: summarizeDebugAttachments(message.attachments),
  };
}

export function summarizeDebugAttachments(attachments) {
  if (!Array.isArray(attachments)) {
    return { kind: attachments === undefined ? "undefined" : "non-array", count: 0, items: [] };
  }
  return {
    kind: "array",
    count: attachments.length,
    items: attachments.slice(0, 8).map((attachment = {}) => ({
      id: String(attachment.id || attachment.fileId || attachment.attachmentId || ""),
      name: String(attachment.name || attachment.fileName || attachment.filename || ""),
      type: String(attachment.type || attachment.mimeType || attachment.mime || ""),
      size: Number.isFinite(Number(attachment.size)) ? Number(attachment.size) : undefined,
      url: attachment.url ? "present" : "",
    })),
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
  try {
    const entry = {
      phase,
      at: new Date().toISOString(),
      ...payload,
    };
    sessionLogSink?.log?.({
      category: "debug",
      debugType: "resend",
      event: phase,
      sessionId: payload?.sessionId || "",
      dialogProcessId: payload?.dialogProcessId || "",
      turnScopeId: payload?.turnScopeId || "",
      data: entry,
    });
  } catch {}
}
