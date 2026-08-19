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
export { summarizeDebugAttachments } from "@noobot/shared/debug-projection";
export { recordServiceAgentTransportDebug } from "../../runtime-events/agent-transport-debug.js";

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
  return writeRoutedRuntimeEvent(
    {
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
    },
    sessionLogConfig,
  );
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
  return writeRoutedRuntimeEvent(
    {
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
    },
    sessionLogConfig,
  );
}

export function recordServiceWebSocketLifecycle({
  sessionLogConfig,
  event,
  userId = "",
  sessionId = "",
  dialogProcessId = "",
  turnScopeId = "",
  category = "backend-websocket",
  level = "info",
  debugType = "",
  data = {},
} = {}) {
  const normalizedSessionId = String(sessionId || "").trim();
  return writeRoutedRuntimeEvent(
    {
      scope: normalizedSessionId ? "session" : "system",
      source: "service",
      channel: RUNTIME_EVENT_CHANNELS.DIRECT,
      category,
      level,
      debugType,
      event,
      userId,
      sessionId: normalizedSessionId,
      dialogProcessId,
      turnScopeId,
      data: { ...data, hasSessionContext: Boolean(normalizedSessionId) },
    },
    sessionLogConfig,
  );
}
