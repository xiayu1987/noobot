import path from 'node:path';
import { RUNTIME_EVENT_SCOPES } from './constants.js';
import { resolveDefaultRuntimeEventsConfig } from './config.js';
import { safeSegment } from './sanitize.js';

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

export function resolveRuntimeEventDir(record, config = resolveRuntimeEventsConfig(record)) {
  if (config.root) {
    if (record.scope === RUNTIME_EVENT_SCOPES.SESSION) return path.join(config.root, safeSegment(record.sessionId));
    return path.join(config.root, safeSegment(record.scope), safeSegment(record.source));
  }
  const workspaceRoot = path.resolve(String(record.workspaceRoot || config.workspaceRoot));
  if (record.scope === RUNTIME_EVENT_SCOPES.SESSION) {
    return path.join(workspaceRoot, safeSegment(record.userId), 'runtime', 'session', safeSegment(record.sessionId), config.dirName);
  }
  const userPart = record.userId ? safeSegment(record.userId) : 'system';
  return path.join(workspaceRoot, userPart, 'runtime', config.dirName, safeSegment(record.scope), safeSegment(record.source));
}

export function resolveRuntimeEventFile(record, config = resolveRuntimeEventsConfig(record)) {
  return path.join(resolveRuntimeEventDir(record, config), `${resolveRuntimeEventFileCategory(record)}.jsonl`);
}

export function resolveRuntimeEventFileCategory(record = {}) {
  const category = safeSegment(record.category);
  if (record.scope !== RUNTIME_EVENT_SCOPES.SESSION || category !== DEBUG_CATEGORY) return category;

  const debugType = safeSegment(record.debugType || record.data?.debugType || '');
  return debugType && debugType !== 'unknown' ? `${DEBUG_CATEGORY}-${debugType}` : DEBUG_CATEGORY;
}
