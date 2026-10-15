/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRuntimeEvent,
} from "@noobot/runtime-events";
import { text } from "@noobot/shared/value";
export { summarizeDebugAttachments } from "@noobot/shared/debug-projection";
export { recordServiceAgentTransportDebug } from "../../runtime-events/agent-transport-debug.js";

export function recordServiceWebSocketSendFailure({
  eventName = "",
  sessionId = "",
  userId = "",
  dialogProcessId = "",
  turnScopeId = "",
  error = null,
} = {}) {
  const normalizedSessionId = text(sessionId);
  if (!normalizedSessionId) return Promise.resolve({ ok: true, skipped: true });
  return writeRuntimeEvent({
    scope: "session",
    source: "service",
    channel: RUNTIME_EVENT_CHANNELS.DIRECT,
    category: RUNTIME_EVENT_CATEGORIES.SYSTEM,
    event: "service.websocket.sendEvent.failed",
    sessionId: normalizedSessionId,
    userId: text(userId),
    dialogProcessId: text(dialogProcessId),
    turnScopeId: text(turnScopeId),
    data: {
      eventName: String(eventName || ""),
      error: error?.message || String(error || ""),
    },
  });
}

const trimRuntimeText = (value) => text(value);

function describeRuntimeError(error) {
  return error?.message || String(error || "");
}

export function recordServiceWebSocketRuntimeError({
  event = "service.websocket.runtime.failed",
  userId = "",
  sessionId = "",
  parentSessionId = "",
  dialogProcessId = "",
  turnScopeId = "",
  error = null,
  data = {},
} = {}) {
  const normalizedSessionId = trimRuntimeText(sessionId);
  if (!normalizedSessionId) return Promise.resolve({ ok: true, skipped: true });
  return writeRuntimeEvent({
    scope: "session",
    source: "service",
    channel: RUNTIME_EVENT_CHANNELS.DIRECT,
    category: RUNTIME_EVENT_CATEGORIES.SYSTEM,
    event,
    userId: trimRuntimeText(userId),
    sessionId: normalizedSessionId,
    parentSessionId: trimRuntimeText(parentSessionId),
    dialogProcessId: trimRuntimeText(dialogProcessId),
    turnScopeId: trimRuntimeText(turnScopeId),
    data: {
      ...(data && typeof data === "object" ? data : {}),
      error: describeRuntimeError(error),
    },
  });
}

export function recordServiceWebSocketLifecycle({
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
  const normalizedSessionId = text(sessionId);
  return writeRuntimeEvent({
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
  });
}
