/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RUNTIME_EVENT_CATEGORIES, RUNTIME_EVENT_CHANNELS, RUNTIME_EVENT_LEVELS, RUNTIME_EVENT_SCOPES } from './constants.js';
import { safeSegment, sanitizeValue, serializeError } from './sanitize.js';

const scopes = new Set(Object.values(RUNTIME_EVENT_SCOPES));
const levels = new Set(Object.values(RUNTIME_EVENT_LEVELS));
const categories = new Set(Object.values(RUNTIME_EVENT_CATEGORIES));

export function buildProcessInfo(includeProcess = true) {
  if (!includeProcess) return undefined;
  return { pid: process.pid, platform: process.platform, arch: process.arch, nodeVersion: process.version, uptimeMs: Math.round(process.uptime() * 1000) };
}

export function normalizeRuntimeEvent(event = {}, defaults = {}) {
  const scope = event.scope || defaults.scope || RUNTIME_EVENT_SCOPES.SYSTEM;
  if (!scopes.has(scope)) throw new Error(`Invalid runtime event scope: ${scope}`);
  const level = event.level || defaults.level || RUNTIME_EVENT_LEVELS.INFO;
  if (!levels.has(level)) throw new Error(`Invalid runtime event level: ${level}`);
  const category = event.category || defaults.category || RUNTIME_EVENT_CATEGORIES.SYSTEM;
  if (!categories.has(category)) throw new Error(`Invalid runtime event category: ${category}`);
  const source = event.source || defaults.source;
  const name = event.event || defaults.event;
  if (!source) throw new Error('Runtime event source is required');
  if (!name) throw new Error('Runtime event name is required');
  if (scope === RUNTIME_EVENT_SCOPES.SESSION && (!event.userId && !defaults.userId || !event.sessionId && !defaults.sessionId)) {
    throw new Error('Session runtime event requires userId and sessionId');
  }
  const record = {
    version: 1,
    time: event.time || new Date().toISOString(),
    source: safeSegment(source),
    scope,
    channel: safeSegment(event.channel || defaults.channel || (scope === RUNTIME_EVENT_SCOPES.STARTUP ? RUNTIME_EVENT_CHANNELS.STARTUP : RUNTIME_EVENT_CHANNELS.DIRECT)),
    category,
    level,
    event: String(name),
  };
  for (const key of ['userId', 'sessionId', 'parentSessionId', 'dialogProcessId', 'turnScopeId']) {
    const value = event[key] ?? defaults[key];
    if (value) record[key] = safeSegment(value);
  }
  const workspaceRoot = event.workspaceRoot || defaults.workspaceRoot;
  if (workspaceRoot) record.workspaceRoot = String(workspaceRoot);
  const processInfo = event.process ?? defaults.process ?? buildProcessInfo(defaults.includeProcess ?? true);
  if (processInfo) record.process = sanitizeValue(processInfo);
  if (event.data || defaults.data) record.data = sanitizeValue({ ...(defaults.data || {}), ...(event.data || {}) });
  const error = event.error || defaults.error;
  if (error) record.error = serializeError(error);
  const tags = event.tags || defaults.tags;
  if (Array.isArray(tags) && tags.length) record.tags = tags.map((tag) => safeSegment(tag));
  return record;
}

export { RUNTIME_EVENT_SCOPES, RUNTIME_EVENT_LEVELS, RUNTIME_EVENT_CATEGORIES, RUNTIME_EVENT_CHANNELS } from './constants.js';
