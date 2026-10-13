/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { requireWorkspaceRootEnv } from "@noobot/runtime-topology-protocol/workspace-root";
import { RUNTIME_EVENTS_DIR } from "./constants.js";
import {
  resolveRuntimeEventsMaxArchives,
  resolveRuntimeEventsMaxFileBytes,
  resolveRuntimeEventsRetentionDays,
} from "@noobot/shared/runtime-events-config";

export function resolveDefaultRuntimeEventsConfig(
  env = process.env,
  { requireWorkspaceRoot = true } = {},
) {
  return {
    workspaceRoot: requireWorkspaceRoot ? requireWorkspaceRootEnv(env) : "",
    dirName: RUNTIME_EVENTS_DIR,
    maxFileBytes: resolveRuntimeEventsMaxFileBytes(env),
    retentionDays: resolveRuntimeEventsRetentionDays(env),
    maxArchives: resolveRuntimeEventsMaxArchives(env),
  };
}
