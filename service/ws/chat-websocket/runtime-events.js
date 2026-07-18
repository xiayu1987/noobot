/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRoutedRuntimeEvent,
} from "@noobot/runtime-events";

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

export function recordServiceWebSocketSendFailure({
  sessionLogConfig,
  eventName = "",
  sessionId = "",
  userId = "",
  dialogProcessId = "",
  turnScopeId = "",
  error = null,
} = {}) {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId) return Promise.resolve({ ok: true, skipped: true });
  return writeRoutedRuntimeEvent({
      scope: "session",
    source: "service",
    channel: RUNTIME_EVENT_CHANNELS.DIRECT,
    category: RUNTIME_EVENT_CATEGORIES.SYSTEM,
    event: "service.websocket.sendEvent.failed",
    sessionId: normalizedSessionId,
    userId: String(userId || "").trim(),
    dialogProcessId: String(dialogProcessId || "").trim(),
    turnScopeId: String(turnScopeId || "").trim(),
    data: {
      eventName: String(eventName || ""),
      error: error?.message || String(error || ""),
    },
  }, sessionLogConfig);
}

export function recordServiceWebSocketRuntimeError({
  sessionLogConfig,
  event = "service.websocket.runtime.failed",
  userId = "",
  sessionId = "",
  parentSessionId = "",
  dialogProcessId = "",
  turnScopeId = "",
  error = null,
  data = {},
} = {}) {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId) return Promise.resolve({ ok: true, skipped: true });
  return writeRoutedRuntimeEvent({
      scope: "session",
    source: "service",
    channel: RUNTIME_EVENT_CHANNELS.DIRECT,
    category: RUNTIME_EVENT_CATEGORIES.SYSTEM,
    event,
    userId: String(userId || "").trim(),
    sessionId: normalizedSessionId,
    parentSessionId: String(parentSessionId || "").trim(),
    dialogProcessId: String(dialogProcessId || "").trim(),
    turnScopeId: String(turnScopeId || "").trim(),
    data: {
      ...(data && typeof data === "object" ? data : {}),
      error: error?.message || String(error || ""),
    },
  }, sessionLogConfig);
}

export function recordServiceWebSocketLifecycle({ sessionLogConfig, event, userId = "", sessionId = "", dialogProcessId = "", turnScopeId = "", data = {} } = {}) {
  const normalizedSessionId = String(sessionId || "").trim();
  return writeRoutedRuntimeEvent({
    scope: normalizedSessionId ? "session" : "system",
    source: "service",
    channel: RUNTIME_EVENT_CHANNELS.DIRECT,
    category: "backend-websocket",
    level: "info",
    event,
    userId,
    sessionId: normalizedSessionId,
    dialogProcessId,
    turnScopeId,
    data: { ...data, hasSessionContext: Boolean(normalizedSessionId) },
  }, sessionLogConfig);
}
