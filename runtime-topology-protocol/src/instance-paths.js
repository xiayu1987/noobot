/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const RUNTIME_INSTANCE_PATH_ENV_KEYS = Object.freeze([
  "NOOBOT_USER_DATA_DIR",
  "NOOBOT_CONFIG_DIR",
  "NOOBOT_DATA_DIR",
  "NOOBOT_LOG_DIR",
  "NOOBOT_GLOBAL_CONFIG_PATH",
  "AGENT_GLOBAL_CONFIG_PATH",
  "NOOBOT_WORKSPACE_ROOT",
  "NOOBOT_WORKSPACE_TEMPLATE_PATH",
  "NOOBOT_RUNTIME_EVENTS_ROOT",
  "NOOBOT_RUNTIME_EVENTS_WORKSPACE_ROOT",
  "NOOBOT_BROWSER_PROFILE_ROOT",
  "NOOBOT_SESSION_LOG_ROOT",
]);

export function withoutRuntimeInstancePaths(env = {}) {
  const output = { ...env };
  for (const key of RUNTIME_INSTANCE_PATH_ENV_KEYS) delete output[key];
  return output;
}
