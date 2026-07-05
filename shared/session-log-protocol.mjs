/*
 * Copyright (c) 2026 xiayu
 * SPDX-License-Identifier: MIT
 */

export const SESSION_LOG_CATEGORIES = Object.freeze([
  "state",
  "message",
  "interaction",
  "transport",
  "debug",
  "agent-proxy",
  "system",
]);

export const SESSION_LOG_CATEGORY_SET = new Set(SESSION_LOG_CATEGORIES);
export const SESSION_LOG_DEBUG_CATEGORY = "debug";
export const SESSION_LOG_DEFAULT_CATEGORY = "system";
export const SESSION_LOG_AGENT_PROXY_DEFAULT_CATEGORY = "agent-proxy";

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

export function isSessionLogDebugEnabled(category, debugEnabled = false) {
  return !isSessionLogDebugCategory(category) || Boolean(debugEnabled);
}

export function buildSessionLogRecord(event = {}, options = {}) {
  const data = event.data && typeof event.data === "object" ? event.data : {};
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
