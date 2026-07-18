/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { resolveRuntimeEventsSessionLogControls } from "@noobot/shared/runtime-events-config";

export const SESSION_LOG_CATEGORIES = Object.freeze([
  "state",
  "message",
  "interaction",
  "transport",
  "debug",
  "agent-proxy",
  "system",
  "frontend-lifecycle",
  "agent-proxy-http",
  "agent-proxy-websocket",
  "agent-proxy-route",
  "backend-websocket",
  "backend-lifecycle",
]);

export const SESSION_LOG_CATEGORY_SET = new Set(SESSION_LOG_CATEGORIES);
export const SESSION_LOG_DEBUG_CATEGORY = "debug";
export const SESSION_LOG_DEFAULT_CATEGORY = "system";
export const SESSION_LOG_AGENT_PROXY_DEFAULT_CATEGORY = "agent-proxy";
export const SESSION_LOG_ALL_TYPES = "*";

export const SESSION_LOG_CONTROL_KEYS = Object.freeze({
  state: "stateLog",
  message: "messageLog",
  interaction: "interactionLog",
  transport: "transportLog",
  "agent-proxy": "agentProxyLog",
  system: "systemLog",
  "frontend-lifecycle": "frontendLifecycleLog",
  "agent-proxy-http": "agentProxyHttpLog",
  "agent-proxy-websocket": "agentProxyWebSocketLog",
  "agent-proxy-route": "agentProxyRouteLog",
  "backend-websocket": "backendWebSocketLog",
  "backend-lifecycle": "backendLifecycleLog",
});

export const SESSION_LOG_DEBUG_CONTROL_KEYS = Object.freeze({
  "state-machine": "stateMachineDebug",
  resend: "resendDebug",
  stop: "stopDebug",
  "session-log-ws": "sessionLogWsDebug",
  "stop-continue": "frontendStopContinueDebug",
  "reconnect-timing": "frontendReconnectTimingDebug",
  "agent-proxy-route": "agentProxyRouteDebug",
});

export const SESSION_LOG_RECORD_FIELDS = Object.freeze([
  "ts",
  "source",
  "category",
  "level",
  "event",
  "sessionId",
  "dialogProcessId",
  "turnScopeId",
  "message",
  "data",
]);

export function normalizeSessionLogText(value = "", { fallback = "", maxLength = 4000 } = {}) {
  const text = String(value || fallback || "").trim();
  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

export function normalizeSessionLogCategory(category, fallback = SESSION_LOG_DEFAULT_CATEGORY) {
  const fallbackValue = SESSION_LOG_CATEGORY_SET.has(String(fallback || "").trim().toLowerCase())
    ? String(fallback).trim().toLowerCase()
    : SESSION_LOG_DEFAULT_CATEGORY;
  const value = String(category || fallbackValue).trim().toLowerCase();
  return SESSION_LOG_CATEGORY_SET.has(value) ? value : fallbackValue;
}

export function isSessionLogDebugCategory(category) {
  return normalizeSessionLogCategory(category) === SESSION_LOG_DEBUG_CATEGORY;
}

export function resolveSessionLogControlConfig(options = {}) {
  return resolveRuntimeEventsSessionLogControls(options.env || process.env, options.sessionLogControls || options.controls || options);
}

export function isSessionLogDebugEvent(event = {}) {
  return isSessionLogDebugCategory(event.category || event.type)
    || String(event.level || "").trim().toLowerCase() === "debug"
    || Boolean(String(event.debugType || event.data?.debugType || "").trim());
}

export function getSessionLogDebugType(event = {}) {
  return String(event.debugType || event.data?.debugType || event.event || event.name || event.category || SESSION_LOG_DEBUG_CATEGORY).trim().toLowerCase() || SESSION_LOG_DEBUG_CATEGORY;
}

export function getSessionLogControlKey(event = {}, category = normalizeSessionLogCategory(event.category || event.type)) {
  return SESSION_LOG_CONTROL_KEYS[category] || SESSION_LOG_CONTROL_KEYS.system;
}

export function getSessionLogDebugControlKey(event = {}) {
  const debugType = getSessionLogDebugType(event);
  if (SESSION_LOG_DEBUG_CONTROL_KEYS[debugType]) return SESSION_LOG_DEBUG_CONTROL_KEYS[debugType];
  if (debugType.includes("state")) return SESSION_LOG_DEBUG_CONTROL_KEYS["state-machine"];
  if (debugType.includes("resend")) return SESSION_LOG_DEBUG_CONTROL_KEYS.resend;
  if (debugType.includes("stop-continue") || (debugType.includes("continue") && debugType.includes("stop"))) return SESSION_LOG_DEBUG_CONTROL_KEYS["stop-continue"];
  if (debugType.includes("stop")) return SESSION_LOG_DEBUG_CONTROL_KEYS.stop;
  if (debugType.includes("agent-proxy-route") || (debugType.includes("agent-proxy") && debugType.includes("route"))) return SESSION_LOG_DEBUG_CONTROL_KEYS["agent-proxy-route"];
  if (debugType.includes("session-log") || debugType.includes("log-ws") || debugType.includes("websocket")) return SESSION_LOG_DEBUG_CONTROL_KEYS["session-log-ws"];
  return "";
}

export function shouldRecordSessionLog(event = {}, options = {}) {
  const control = resolveSessionLogControlConfig(options);
  const category = normalizeSessionLogCategory(event.category || event.type, options.defaultCategory || SESSION_LOG_DEFAULT_CATEGORY);
  if (control[getSessionLogControlKey(event, category)] === false) return false;
  if (!isSessionLogDebugEvent({ ...event, category })) return true;
  const debugControlKey = getSessionLogDebugControlKey({ ...event, category });
  return debugControlKey ? control[debugControlKey] === true : false;
}

export function buildSessionLogRecord(event = {}, options = {}) {
  const data = event.data && typeof event.data === "object" ? { ...event.data } : {};
  if (event.debugType && !data.debugType) data.debugType = event.debugType;
  const fallbackCategory = options.defaultCategory || SESSION_LOG_DEFAULT_CATEGORY;
  const category = normalizeSessionLogCategory(event.category || event.type, fallbackCategory);
  const includeTimestamp = options.includeTimestamp !== false;
  const record = {
    source: normalizeSessionLogText(event.source || options.source || "unknown", { fallback: "unknown", maxLength: 120 }),
    category,
    level: normalizeSessionLogText(event.level || "info", { fallback: "info", maxLength: 32 }).toLowerCase() || "info",
    event: normalizeSessionLogText(event.event || event.name || options.defaultEvent || "log", { fallback: "log", maxLength: 160 }) || "log",
    sessionId: normalizeSessionLogText(event.sessionId || data.sessionId || options.defaultSessionId || "", { maxLength: 160 }),
    dialogProcessId: normalizeSessionLogText(event.dialogProcessId || data.dialogProcessId || "", { maxLength: 160 }),
    turnScopeId: normalizeSessionLogText(event.turnScopeId || data.turnScopeId || "", { maxLength: 160 }),
    message: normalizeSessionLogText(event.message || "", { maxLength: options.messageMaxLength || 4000 }),
    data,
  };
  if (includeTimestamp) record.ts = event.ts || new Date().toISOString();
  return record;
}
