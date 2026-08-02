/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from 'node:path';
import { RUNTIME_EVENT_SCOPES } from './constants.js';
import { resolveDefaultRuntimeEventsConfig } from './config.js';
import { safeSegment } from './sanitize.js';
import { resolveOptionalSessionId } from './session-id.js';

const DEBUG_CATEGORY = 'debug';

export function resolveRuntimeEventsConfig(options = {}) {
  const defaults = resolveDefaultRuntimeEventsConfig();
  return {
    root: options.root || options.runtimeEventsRoot ? path.resolve(String(options.root || options.runtimeEventsRoot)) : '',
    workspaceRoot: path.resolve(String(options.workspaceRoot || defaults.workspaceRoot)),
    dirName: safeSegment(options.dirName || defaults.dirName),
    maxFileBytes: options.maxFileBytes ?? defaults.maxFileBytes,
    retentionDays: options.retentionDays ?? defaults.retentionDays,
    maxArchives: options.maxArchives ?? defaults.maxArchives,
  };
}

export function resolveRuntimeEventStorageSessionId(record = {}) {
  return safeSegment(resolveOptionalSessionId(
    record.storageSessionId,
    record.rootSessionId,
    record.parentSessionId,
    record.data?.storageSessionId,
    record.data?.rootSessionId,
    record.data?.parentSessionId,
    record.sessionId,
  ));
}

export function resolveRuntimeEventDir(record, config = resolveRuntimeEventsConfig()) {
  if (config.root) {
    if (record.scope === RUNTIME_EVENT_SCOPES.SESSION) return path.join(config.root, safeSegment(record.sessionId));
    return path.join(config.root, safeSegment(record.scope), safeSegment(record.source));
  }
  if (record.scope === RUNTIME_EVENT_SCOPES.SESSION) {
    return path.join(config.workspaceRoot, safeSegment(record.userId), 'runtime', 'session', resolveRuntimeEventStorageSessionId(record), config.dirName);
  }
  const userPart = record.userId ? safeSegment(record.userId) : 'system';
  return path.join(config.workspaceRoot, userPart, 'runtime', config.dirName, safeSegment(record.scope), safeSegment(record.source));
}

export function resolveRuntimeEventFile(record, config = resolveRuntimeEventsConfig()) {
  return path.join(resolveRuntimeEventDir(record, config), `${resolveRuntimeEventFileCategory(record)}.jsonl`);
}

export function resolveRuntimeEventFileCategory(record = {}) {
  const category = safeSegment(record.category);
  if (record.scope !== RUNTIME_EVENT_SCOPES.SESSION || category !== DEBUG_CATEGORY) return category;

  const debugType = safeSegment(record.debugType || record.data?.debugType || '');
  return debugType && debugType !== 'unknown' ? `${DEBUG_CATEGORY}-${debugType}` : DEBUG_CATEGORY;
}
