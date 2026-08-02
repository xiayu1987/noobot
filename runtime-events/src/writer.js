/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RUNTIME_EVENT_SCOPES } from './constants.js';
import { normalizeRuntimeEvent } from './schema.js';
import { resolveRuntimeEventFile, resolveRuntimeEventsConfig, resolveRuntimeEventStorageSessionId } from './paths.js';
import { appendJsonLine } from './transports/jsonl.js';
import { isSessionLogDebugEvent, shouldRecordSessionLog } from './session-log-protocol.js';
import { isWorkspaceSessionDeleted, isWorkspaceSessionPersisted } from './session-deletion-guard.js';

export async function writeRuntimeEvent(event = {}, options = {}) {
  try {
    const defaults = options.defaults || options;
    const config = resolveRuntimeEventsConfig({
      ...defaults,
      ...options,
      workspaceRoot: event.workspaceRoot ?? defaults.workspaceRoot ?? options.workspaceRoot,
    });
    const record = normalizeRuntimeEvent(event, defaults);
    const controlledLog = record.scope === RUNTIME_EVENT_SCOPES.SESSION || isSessionLogDebugEvent(record);
    if (controlledLog && !shouldRecordSessionLog(record, { ...defaults, ...options, ...config })) {
      return { ok: true, skipped: true, record };
    }
    if (record.scope === RUNTIME_EVENT_SCOPES.SESSION && !config.root) {
      const storageSessionId = resolveRuntimeEventStorageSessionId(record);
      const sessionIds = [...new Set([record.sessionId, storageSessionId].filter(Boolean))];
      for (const sessionId of sessionIds) {
        if (await isWorkspaceSessionDeleted({ workspaceRoot: config.workspaceRoot, userId: record.userId, sessionId })) {
          return { ok: true, skipped: true, deleted: true, record };
        }
      }
      if (storageSessionId === record.sessionId && !await isWorkspaceSessionPersisted({
        workspaceRoot: config.workspaceRoot,
        userId: record.userId,
        sessionId: storageSessionId,
      })) {
        return { ok: true, skipped: true, missingSession: true, record };
      }
    }
    const file = resolveRuntimeEventFile(record, config);
    const writeResult = await appendJsonLine(file, record, {
      maxFileBytes: config.maxFileBytes,
      retentionDays: config.retentionDays,
      maxArchives: config.maxArchives,
      cleanupIntervalMs: options.cleanupIntervalMs,
    });
    return {
      ok: true,
      file,
      record,
      rotatedFile: writeResult.rotatedFile,
      deletedFiles: writeResult.deletedFiles,
      cleanupError: writeResult.cleanupError,
    };
  } catch (error) {
    if (options.throwOnError) throw error;
    return { ok: false, error };
  }
}

export function createRuntimeEventWriter(defaults = {}) {
  return {
    write: (event = {}, options = {}) => writeRuntimeEvent(event, { ...options, defaults: { ...defaults, ...(options.defaults || {}) } }),
    routed: (event = {}, options = {}) => writeRoutedRuntimeEvent(event, { ...options, defaults: { ...defaults, ...(options.defaults || {}) } }),
    startup: (event = {}, options = {}) => writeRuntimeEvent({ ...event, scope: RUNTIME_EVENT_SCOPES.STARTUP }, { ...options, defaults }),
    session: (event = {}, options = {}) => writeRuntimeEvent({ ...event, scope: RUNTIME_EVENT_SCOPES.SESSION }, { ...options, defaults }),
    system: (event = {}, options = {}) => writeRuntimeEvent({ ...event, scope: RUNTIME_EVENT_SCOPES.SYSTEM }, { ...options, defaults }),
  };
}

function hasRuntimeSessionContext(event = {}, defaults = {}) {
  return Boolean((event.sessionId ?? defaults.sessionId) && (event.userId ?? defaults.userId));
}

function withoutSessionContext(event = {}) {
  const {
    sessionId,
    parentSessionId,
    dialogProcessId,
    turnScopeId,
    ...systemEvent
  } = event;
  return systemEvent;
}

export function writeRoutedRuntimeEvent(event = {}, options = {}) {
  const defaults = options.defaults || options;
  const explicitScope = event.scope ?? defaults.scope;
  if (explicitScope === RUNTIME_EVENT_SCOPES.STARTUP) {
    return writeRuntimeEvent({ ...event, scope: RUNTIME_EVENT_SCOPES.STARTUP }, options);
  }
  if (explicitScope === RUNTIME_EVENT_SCOPES.SYSTEM) {
    return writeRuntimeEvent({ ...withoutSessionContext(event), scope: RUNTIME_EVENT_SCOPES.SYSTEM }, {
      ...options,
      defaults: withoutSessionContext(defaults),
    });
  }
  if (hasRuntimeSessionContext(event, defaults)) {
    return writeRuntimeEvent({ ...event, scope: RUNTIME_EVENT_SCOPES.SESSION }, options);
  }
  return writeRuntimeEvent({ ...withoutSessionContext(event), scope: RUNTIME_EVENT_SCOPES.SYSTEM }, {
    ...options,
    defaults: withoutSessionContext(defaults),
  });
}

export const writeStartupEvent = (event = {}, options = {}) => writeRoutedRuntimeEvent({ ...event, scope: RUNTIME_EVENT_SCOPES.STARTUP }, options);
export const writeSessionRuntimeEvent = (event = {}, options = {}) => writeRuntimeEvent({ ...event, scope: RUNTIME_EVENT_SCOPES.SESSION }, options);
export const writeSystemRuntimeEvent = (event = {}, options = {}) => writeRoutedRuntimeEvent({ ...event, scope: RUNTIME_EVENT_SCOPES.SYSTEM }, options);
