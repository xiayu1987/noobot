/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * Central runtime logging/event configuration.
 */

function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

export const RUNTIME_EVENTS_CONFIG_ENVS = deepFreeze({
  runtimeEvents: {
    maxFileBytes: "NOOBOT_RUNTIME_EVENTS_MAX_FILE_BYTES",
    retentionDays: "NOOBOT_RUNTIME_EVENTS_RETENTION_DAYS",
    maxArchives: "NOOBOT_RUNTIME_EVENTS_MAX_ARCHIVES",
  },
  hookRuntimeEvents: {
    mode: "NOOBOT_HOOK_RUNTIME_EVENTS_MODE",
  },
});

export const RUNTIME_EVENTS_CONFIG_DEFAULTS = deepFreeze({
  runtimeEvents: {
    maxFileBytes: 5 * 1024 * 1024,
    retentionDays: 7,
    maxArchives: 20,
  },
  hookRuntimeEvents: {
    mode: "summary",
  },
});

export const HOOK_RUNTIME_EVENT_VERBOSE_VALUES = deepFreeze([
  "verbose",
  "trace",
  "debug",
  "full",
  "1",
  "true",
  "on",
  "yes",
]);

function resolveNonNegativeIntegerEnv(env, name, fallback) {
  const raw = env?.[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return value;
}

export function resolveRuntimeEventsMaxFileBytes(env = process.env) {
  return resolveNonNegativeIntegerEnv(
    env,
    RUNTIME_EVENTS_CONFIG_ENVS.runtimeEvents.maxFileBytes,
    RUNTIME_EVENTS_CONFIG_DEFAULTS.runtimeEvents.maxFileBytes,
  );
}

export function resolveRuntimeEventsRetentionDays(env = process.env) {
  return resolveNonNegativeIntegerEnv(
    env,
    RUNTIME_EVENTS_CONFIG_ENVS.runtimeEvents.retentionDays,
    RUNTIME_EVENTS_CONFIG_DEFAULTS.runtimeEvents.retentionDays,
  );
}

export function resolveRuntimeEventsMaxArchives(env = process.env) {
  return resolveNonNegativeIntegerEnv(
    env,
    RUNTIME_EVENTS_CONFIG_ENVS.runtimeEvents.maxArchives,
    RUNTIME_EVENTS_CONFIG_DEFAULTS.runtimeEvents.maxArchives,
  );
}

export function resolveRuntimeEventsStorageConfig(env = process.env) {
  return {
    maxFileBytes: resolveRuntimeEventsMaxFileBytes(env),
    retentionDays: resolveRuntimeEventsRetentionDays(env),
    maxArchives: resolveRuntimeEventsMaxArchives(env),
  };
}

export function resolveHookRuntimeEventsMode({ runtime = {}, options = {}, env = process.env } = {}) {
  return String(
    runtime?.systemRuntime?.hookRuntimeEventsMode ??
      runtime?.hookRuntimeEventsMode ??
      options?.hookRuntimeEventsMode ??
      env?.[RUNTIME_EVENTS_CONFIG_ENVS.hookRuntimeEvents.mode] ??
      RUNTIME_EVENTS_CONFIG_DEFAULTS.hookRuntimeEvents.mode,
  ).trim().toLowerCase();
}

export function isHookRuntimeEventVerboseEnabled(input = {}) {
  return HOOK_RUNTIME_EVENT_VERBOSE_VALUES.includes(resolveHookRuntimeEventsMode(input));
}
