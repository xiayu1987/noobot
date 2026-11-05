/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";

import {
  RUNTIME_EVENTS_SESSION_LOG_CONTROL_KEYS,
  RUNTIME_EVENTS_SESSION_LOG_DEBUG_TYPES,
  isRegisteredSessionLogDebugType,
  resolveRuntimeEventsSessionLogControls,
} from "@noobot/shared/runtime-events-config";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { normalizeOptionalSessionId } from "./session-id.js";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  RUNTIME_EVENT_SCOPES,
} from "./constants.js";
import { text } from "@noobot/shared/value";

// 会话日志的发送通道由发送方声明；服务端入口共用，不能推断。
// 仅 /logs/ws 上报方可用；服务端直写事件使用 RUNTIME_EVENT_CHANNELS，不经本协议。
export const SESSION_CHANNELS = Object.freeze({
  WEB_SOCKET: RUNTIME_EVENT_CHANNELS.WEB_SOCKET,
  AGENT_PROXY_WEB_SOCKET: RUNTIME_EVENT_CHANNELS.AGENT_PROXY_WEB_SOCKET,
});
const SESSION_CHANNEL_SET = new Set(Object.values(SESSION_CHANNELS));

export function requireSessionLogChannel(channel) {
  if (!SESSION_CHANNEL_SET.has(channel)) {
    throw new Error(`Invalid session log channel: ${channel}`);
  }
  return channel;
}

export const SESSION_LOG_CATEGORIES = Object.freeze([
  RUNTIME_EVENT_CATEGORIES.STATE,
  RUNTIME_EVENT_CATEGORIES.MESSAGE,
  RUNTIME_EVENT_CATEGORIES.INTERACTION,
  RUNTIME_EVENT_CATEGORIES.TRANSPORT,
  RUNTIME_EVENT_CATEGORIES.DEBUG,
  RUNTIME_EVENT_CATEGORIES.AGENT_PROXY,
  RUNTIME_EVENT_CATEGORIES.SYSTEM,
  RUNTIME_EVENT_CATEGORIES.FRONTEND_LIFECYCLE,
  RUNTIME_EVENT_CATEGORIES.AGENT_PROXY_HTTP,
  RUNTIME_EVENT_CATEGORIES.AGENT_PROXY_WEBSOCKET,
  RUNTIME_EVENT_CATEGORIES.AGENT_PROXY_ROUTE,
  RUNTIME_EVENT_CATEGORIES.BACKEND_WEBSOCKET,
  RUNTIME_EVENT_CATEGORIES.BACKEND_LIFECYCLE,
]);

const SESSION_LOG_CATEGORY_SET = new Set(SESSION_LOG_CATEGORIES);
export const SESSION_LOG_DEBUG_CATEGORY = RUNTIME_EVENT_CATEGORIES.DEBUG;

const SESSION_LOG_CONTROL_KEYS = RUNTIME_EVENTS_SESSION_LOG_CONTROL_KEYS;

const SESSION_LOG_DEBUG_CONTROL_KEYS = Object.freeze(
  Object.fromEntries(
    Object.entries(RUNTIME_EVENTS_SESSION_LOG_DEBUG_TYPES).map(([debugType, descriptor]) => [
      debugType,
      descriptor.controlKey,
    ]),
  ),
);

function normalizeSessionLogText(
  value = "",
  { fallback = "", maxLength = LENGTH_THRESHOLDS.sessionLog.messageChars } = {},
) {
  const normalizedText = text(value || fallback);
  return maxLength > 0 ? normalizedText.slice(0, maxLength) : normalizedText;
}

export function normalizeSessionLogCategory(category) {
  const value = typeof category === "string" ? category.trim().toLowerCase() : "";
  if (!SESSION_LOG_CATEGORY_SET.has(value)) {
    throw new Error(`Invalid session log category: ${category}`);
  }
  return value;
}

function isSessionLogDebugCategory(category) {
  return category === SESSION_LOG_DEBUG_CATEGORY;
}

function resolveSessionLogControlConfig({ env = process.env } = {}) {
  return resolveRuntimeEventsSessionLogControls(env);
}

export function resolveSessionLogClientPolicy(options = {}) {
  const controls = resolveSessionLogControlConfig(options);
  return {
    debug: Object.fromEntries(
      Object.entries(RUNTIME_EVENTS_SESSION_LOG_DEBUG_TYPES)
        .filter(([, descriptor]) => descriptor.exposeToClient === true)
        .map(([debugType, descriptor]) => [
          debugType,
          controls.debug[descriptor.controlKey] === true,
        ]),
    ),
    limits: {
      maxDebugQueue: QUANTITY_THRESHOLDS.sessionLog.maxDebugQueueSize,
      maxDebugBytes: LENGTH_THRESHOLDS.sessionLog.maxDebugQueueBytes,
      debugTtlMs: TIME_THRESHOLDS.client.sessionLogDebugTtlMs,
    },
  };
}

export function isSessionLogDebugEvent(event = {}) {
  return isSessionLogDebugCategory(event?.category);
}

export function getSessionLogControlKey(category) {
  const normalized = normalizeSessionLogCategory(category);
  if (normalized === SESSION_LOG_DEBUG_CATEGORY) return "";
  const controlKey = SESSION_LOG_CONTROL_KEYS[normalized];
  if (!controlKey) throw new Error(`Session log category has no control key: ${normalized}`);
  return controlKey;
}

export function getSessionLogDebugControlKey(event = {}) {
  return isRegisteredSessionLogDebugType(event.debugType)
    ? SESSION_LOG_DEBUG_CONTROL_KEYS[event.debugType]
    : "";
}

export function isSessionLogDebugTypeEnabled(debugType, options = {}) {
  const controlKey = getSessionLogDebugControlKey({ debugType });
  if (!controlKey) return false;
  return resolveSessionLogControlConfig(options).debug[controlKey] === true;
}

export function shouldRecordSessionLog(event = {}, options = {}) {
  const level = text(event?.level).toLowerCase();
  if (["warn", "error", "fatal"].includes(level) || event?.error) return true;
  const control = resolveSessionLogControlConfig(options);
  const category = normalizeSessionLogCategory(event.category);
  if (category !== SESSION_LOG_DEBUG_CATEGORY) {
    return control.log[getSessionLogControlKey(category)] !== false;
  }
  const debugControlKey = getSessionLogDebugControlKey(event);
  return debugControlKey ? control.debug[debugControlKey] === true : false;
}

export function buildSessionLogRecord(event = {}) {
  const scope = event.scope;
  if (scope !== RUNTIME_EVENT_SCOPES.SESSION && scope !== RUNTIME_EVENT_SCOPES.SYSTEM) {
    throw new Error(`Invalid session log scope: ${scope}`);
  }
  const channel = requireSessionLogChannel(event.channel);
  const data = event.data && typeof event.data === "object" ? { ...event.data } : {};
  const source = normalizeSessionLogText(event.source, {
    maxLength: LENGTH_THRESHOLDS.sessionLog.sourceChars,
  });
  if (!source) throw new Error("Session log source is required");
  const name = normalizeSessionLogText(event.event, {
    maxLength: LENGTH_THRESHOLDS.sessionLog.identityChars,
  });
  if (!name) throw new Error("Session log event is required");
  const sessionId = normalizeSessionLogText(event.sessionId, {
    maxLength: LENGTH_THRESHOLDS.sessionLog.identityChars,
  });
  if (scope === RUNTIME_EVENT_SCOPES.SESSION && !sessionId) {
    throw new Error("Session-scoped session log requires sessionId");
  }
  if (scope === RUNTIME_EVENT_SCOPES.SYSTEM && sessionId) {
    throw new Error("System-scoped session log must not carry sessionId");
  }
  const category = normalizeSessionLogCategory(event.category);
  const record = {
    scope,
    channel,
    source,
    category,
    level: normalizeSessionLogText(event.level || "info", {
      maxLength: LENGTH_THRESHOLDS.sessionLog.levelChars,
    }).toLowerCase(),
    event: name,
    sessionId,
    dialogProcessId: normalizeSessionLogText(event.dialogProcessId, {
      maxLength: LENGTH_THRESHOLDS.sessionLog.identityChars,
    }),
    turnScopeId: normalizeSessionLogText(event.turnScopeId, {
      maxLength: LENGTH_THRESHOLDS.sessionLog.identityChars,
    }),
    message: normalizeSessionLogText(event.message, {
      maxLength: LENGTH_THRESHOLDS.sessionLog.messageChars,
    }),
    data,
  };
  if (category === SESSION_LOG_DEBUG_CATEGORY && typeof event.debugType === "string") {
    record.debugType = event.debugType;
  }
  const parentSessionId = normalizeOptionalSessionId(event.parentSessionId);
  if (parentSessionId) record.parentSessionId = parentSessionId;
  return record;
}
