/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DEFAULT_WORKSPACE_ROOT, RUNTIME_EVENTS_DIR } from './constants.js';
import {
  resolveRuntimeEventsMaxArchives,
  resolveRuntimeEventsMaxFileBytes,
  resolveRuntimeEventsRetentionDays,
} from '@noobot/shared/runtime-events-config';

const RUNTIME_EVENTS_ROOT_ENV = 'NOOBOT_RUNTIME_EVENTS_ROOT';
const RUNTIME_EVENTS_WORKSPACE_ROOT_ENV = 'NOOBOT_RUNTIME_EVENTS_WORKSPACE_ROOT';

export function resolveDefaultRuntimeEventsConfig(env = process.env) {
  return {
    workspaceRoot:
      env[RUNTIME_EVENTS_WORKSPACE_ROOT_ENV] ||
      env[RUNTIME_EVENTS_ROOT_ENV] ||
      env.NOOBOT_WORKSPACE_ROOT ||
      DEFAULT_WORKSPACE_ROOT,
    dirName: RUNTIME_EVENTS_DIR,
    maxFileBytes: resolveRuntimeEventsMaxFileBytes(env),
    retentionDays: resolveRuntimeEventsRetentionDays(env),
    maxArchives: resolveRuntimeEventsMaxArchives(env),
  };
}
