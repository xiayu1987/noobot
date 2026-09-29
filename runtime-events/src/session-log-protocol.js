/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  RUNTIME_EVENTS_SESSION_LOG_CONTROL_KEYS,
  RUNTIME_EVENTS_SESSION_LOG_DEBUG_TYPES,
  isRegisteredSessionLogDebugType,
  resolveRuntimeEventsSessionLogControls,
} from "@noobot/shared/runtime-events-config";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { normalizeOptionalSessionId } from "./session-id.js";
import { RUNTIME_EVENT_CATEGORIES } from "./constants.js";

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
export const SESSION_LOG_DEFAULT_CATEGORY = RUNTIME_EVENT_CATEGORIES.SYSTEM;
export const SESSION_LOG_AGENT_PROXY_DEFAULT_CATEGORY = RUNTIME_EVENT_CATEGORIES.AGENT_PROXY;

export const SESSION_LOG_CONTROL_KEYS = RUNTIME_EVENTS_SESSION_LOG_CONTROL_KEYS;

export const SESSION_LOG_DEBUG_CONTROL_KEYS = Object.freeze(
  Object.fromEntries(
    Object.entries(RUNTIME_EVENTS_SESSION_LOG_DEBUG_TYPES).map(([debugType, descriptor]) => [
      debugType,
      descriptor.controlKey,
    ]),
  ),
);

export function normalizeSessionLogText(value = "", { fallback = "", maxLength = 4000 } = {}) {
  const text = String(value || fallback || "").trim();
  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

export function normalizeSessionLogCategory(category, fallback = SESSION_LOG_DEFAULT_CATEGORY) {
  const fallbackValue = SESSION_LOG_CATEGORY_SET.has(
    String(fallback || "")
      .trim()
      .toLowerCase(),
  )
    ? String(fallback).trim().toLowerCase()
    : SESSION_LOG_DEFAULT_CATEGORY;
  const value = String(category || fallbackValue)
    .trim()
    .toLowerCase();
  return SESSION_LOG_CATEGORY_SET.has(value) ? value : fallbackValue;
}

export function isSessionLogDebugCategory(category) {
  return normalizeSessionLogCategory(category) === SESSION_LOG_DEBUG_CATEGORY;
}

export function resolveSessionLogControlConfig(options = {}) {
  return resolveRuntimeEventsSessionLogControls(
    options.env || process.env,
    options.sessionLogControls || {},
  );
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
      maxDebugBytes: QUANTITY_THRESHOLDS.sessionLog.maxDebugQueueBytes,
      debugTtlMs: TIME_THRESHOLDS.client.sessionLogDebugTtlMs,
    },
  };
}

export function isSessionLogDebugEvent(event = {}) {
  return isSessionLogDebugCategory(event.category || event.type);
}

export function getSessionLogControlKey(
  event = {},
  category = normalizeSessionLogCategory(event.category || event.type),
) {
  return SESSION_LOG_CONTROL_KEYS[category] || SESSION_LOG_CONTROL_KEYS.system;
}

export function getSessionLogDebugControlKey(event = {}) {
  return isRegisteredSessionLogDebugType(event.debugType)
    ? SESSION_LOG_DEBUG_CONTROL_KEYS[event.debugType]
    : "";
}

export function shouldRecordSessionLog(event = {}, options = {}) {
  const level = String(event?.level || "")
    .trim()
    .toLowerCase();
  if (["warn", "error", "fatal"].includes(level) || event?.error) return true;
  const control = resolveSessionLogControlConfig(options);
  const category = normalizeSessionLogCategory(
    event.category || event.type,
    options.defaultCategory || SESSION_LOG_DEFAULT_CATEGORY,
  );
  if (control.log[getSessionLogControlKey(event, category)] === false) return false;
  if (!isSessionLogDebugEvent({ ...event, category })) return true;
  const debugControlKey = getSessionLogDebugControlKey({ ...event, category });
  return debugControlKey ? control.debug[debugControlKey] === true : false;
}

export function buildSessionLogRecord(event = {}, options = {}) {
  const data = event.data && typeof event.data === "object" ? { ...event.data } : {};
  for (const key of ["parentSessionId", "rootSessionId", "storageSessionId"]) {
    const value = normalizeOptionalSessionId(data[key]);
    if (value) data[key] = value;
    else delete data[key];
  }
  const fallbackCategory = options.defaultCategory || SESSION_LOG_DEFAULT_CATEGORY;
  const category = normalizeSessionLogCategory(event.category || event.type, fallbackCategory);
  const includeTimestamp = options.includeTimestamp !== false;
  const record = {
    source: normalizeSessionLogText(event.source || options.source || "unknown", {
      fallback: "unknown",
      maxLength: 120,
    }),
    category,
    level:
      normalizeSessionLogText(event.level || "info", {
        fallback: "info",
        maxLength: 32,
      }).toLowerCase() || "info",
    event:
      normalizeSessionLogText(event.event || event.name || options.defaultEvent || "log", {
        fallback: "log",
        maxLength: 160,
      }) || "log",
    sessionId: normalizeSessionLogText(
      event.sessionId || data.sessionId || options.defaultSessionId || "",
      { maxLength: 160 },
    ),
    dialogProcessId: normalizeSessionLogText(event.dialogProcessId || data.dialogProcessId || "", {
      maxLength: 160,
    }),
    turnScopeId: normalizeSessionLogText(event.turnScopeId || data.turnScopeId || "", {
      maxLength: 160,
    }),
    message: normalizeSessionLogText(event.message || "", {
      maxLength: options.messageMaxLength || 4000,
    }),
    data,
  };
  if (category === SESSION_LOG_DEBUG_CATEGORY && typeof event.debugType === "string") {
    record.debugType = event.debugType;
  }
  for (const key of ["parentSessionId", "rootSessionId", "storageSessionId"]) {
    const value = normalizeOptionalSessionId(event[key]) || normalizeOptionalSessionId(data[key]);
    if (value) record[key] = value;
  }
  if (includeTimestamp) record.ts = event.ts || new Date().toISOString();
  return record;
}
