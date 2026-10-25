/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isRegisteredSessionLogDebugType } from "@noobot/shared/runtime-events-config";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  RUNTIME_EVENT_LEVELS,
  RUNTIME_EVENT_SCOPES,
  STARTUP_LAUNCH_ID_ENV,
} from "./constants.js";
import { safeSegment, sanitizeValue, serializeError } from "./sanitize.js";
import { normalizeOptionalSessionId } from "./session-id.js";
import { text } from "@noobot/shared/value";

const scopes = new Set(Object.values(RUNTIME_EVENT_SCOPES));
const levels = new Set(Object.values(RUNTIME_EVENT_LEVELS));
const categories = new Set(Object.values(RUNTIME_EVENT_CATEGORIES));

function buildProcessInfo() {
  return {
    pid: process.pid,
    launchId: text(process.env[STARTUP_LAUNCH_ID_ENV]),
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    uptimeMs: Math.round(process.uptime() * 1000),
  };
}

function normalizeIdentity(value) {
  return text(value).slice(0, 256);
}

function resolveRecordDebugType({ category, level, debugType }) {
  const isDebugCategory = category === RUNTIME_EVENT_CATEGORIES.DEBUG;
  if (level === RUNTIME_EVENT_LEVELS.DEBUG && !isDebugCategory) {
    throw new Error(`Runtime event level debug requires category debug, got: ${category}`);
  }
  if (!isDebugCategory) {
    if (debugType !== undefined && debugType !== "") {
      throw new Error(`Runtime event debugType is only allowed for category debug: ${category}`);
    }
    return "";
  }
  if (!isRegisteredSessionLogDebugType(debugType)) {
    throw new Error(`Invalid runtime event debugType: ${debugType}`);
  }
  return debugType;
}

export function normalizeRuntimeEventEnvelope(event = {}) {
  const scope = event.scope;
  if (!scopes.has(scope)) throw new Error(`Invalid runtime event scope: ${scope}`);
  const level = event.level || RUNTIME_EVENT_LEVELS.INFO;
  if (!levels.has(level)) throw new Error(`Invalid runtime event level: ${level}`);
  const category = event.category;
  if (!categories.has(category)) throw new Error(`Invalid runtime event category: ${category}`);
  const source = event.source;
  const name = event.event;
  if (!source) throw new Error("Runtime event source is required");
  if (!name) throw new Error("Runtime event name is required");
  const debugType = resolveRecordDebugType({
    category,
    level,
    debugType: event.debugType,
  });
  if (scope === RUNTIME_EVENT_SCOPES.SESSION && (!event.userId || !event.sessionId)) {
    throw new Error("Session runtime event requires userId and sessionId");
  }
  const record = {
    version: 1,
    time: event.time || new Date().toISOString(),
    source: safeSegment(source),
    scope,
    channel: safeSegment(
      event.channel ||
        (scope === RUNTIME_EVENT_SCOPES.STARTUP
          ? RUNTIME_EVENT_CHANNELS.STARTUP
          : RUNTIME_EVENT_CHANNELS.DIRECT),
    ),
    category,
    level,
    event: String(name),
  };
  if (debugType) record.debugType = debugType;
  for (const key of ["userId", "sessionId", "dialogProcessId", "turnScopeId"]) {
    const value = event[key];
    if (value) record[key] = normalizeIdentity(value);
  }
  const parentSessionId = normalizeOptionalSessionId(event.parentSessionId);
  if (parentSessionId) record.parentSessionId = parentSessionId;
  const error = event.error;
  if (error) record.error = serializeError(error);
  return record;
}

export function attachRuntimeEventPayload(record, event = {}) {
  record.process = sanitizeValue(event.process ?? buildProcessInfo());
  if (event.data) {
    record.data = sanitizeValue({ ...event.data });
  }
  const tags = event.tags;
  if (Array.isArray(tags) && tags.length) record.tags = tags.map((tag) => safeSegment(tag));
  return record;
}
