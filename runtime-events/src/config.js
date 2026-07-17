/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DEFAULT_WORKSPACE_ROOT, RUNTIME_EVENTS_DIR } from './constants.js';
import {
  RUNTIME_EVENTS_CONFIG_DEFAULTS,
  RUNTIME_EVENTS_CONFIG_ENVS,
  resolveRuntimeEventsMaxArchives,
  resolveRuntimeEventsMaxFileBytes,
  resolveRuntimeEventsRetentionDays,
} from '@noobot/shared/runtime-events-config';

export const DEFAULT_RUNTIME_EVENTS_ROOT_ENV = 'NOOBOT_RUNTIME_EVENTS_ROOT';
export const DEFAULT_RUNTIME_EVENTS_WORKSPACE_ROOT_ENV = 'NOOBOT_RUNTIME_EVENTS_WORKSPACE_ROOT';
export const DEFAULT_RUNTIME_EVENTS_MAX_FILE_BYTES_ENV = RUNTIME_EVENTS_CONFIG_ENVS.runtimeEvents.maxFileBytes;
export const DEFAULT_RUNTIME_EVENTS_RETENTION_DAYS_ENV = RUNTIME_EVENTS_CONFIG_ENVS.runtimeEvents.retentionDays;
export const DEFAULT_RUNTIME_EVENTS_MAX_ARCHIVES_ENV = RUNTIME_EVENTS_CONFIG_ENVS.runtimeEvents.maxArchives;

export const DEFAULT_RUNTIME_EVENTS_MAX_FILE_BYTES = RUNTIME_EVENTS_CONFIG_DEFAULTS.runtimeEvents.maxFileBytes;
export const DEFAULT_RUNTIME_EVENTS_RETENTION_DAYS = RUNTIME_EVENTS_CONFIG_DEFAULTS.runtimeEvents.retentionDays;
export const DEFAULT_RUNTIME_EVENTS_MAX_ARCHIVES = RUNTIME_EVENTS_CONFIG_DEFAULTS.runtimeEvents.maxArchives;

export function resolveDefaultRuntimeEventsConfig(env = process.env) {
  return {
    workspaceRoot:
      env[DEFAULT_RUNTIME_EVENTS_WORKSPACE_ROOT_ENV] ||
      env[DEFAULT_RUNTIME_EVENTS_ROOT_ENV] ||
      env.NOOBOT_WORKSPACE_ROOT ||
      DEFAULT_WORKSPACE_ROOT,
    dirName: RUNTIME_EVENTS_DIR,
    maxFileBytes: resolveRuntimeEventsMaxFileBytes(env),
    retentionDays: resolveRuntimeEventsRetentionDays(env),
    maxArchives: resolveRuntimeEventsMaxArchives(env),
  };
}
