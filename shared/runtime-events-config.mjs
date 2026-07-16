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
  sessionLogControls: {
    stateLog: "NOOBOT_RUNTIME_EVENT_STATE_LOG",
    messageLog: "NOOBOT_RUNTIME_EVENT_MESSAGE_LOG",
    interactionLog: "NOOBOT_RUNTIME_EVENT_INTERACTION_LOG",
    transportLog: "NOOBOT_RUNTIME_EVENT_TRANSPORT_LOG",
    agentProxyLog: "NOOBOT_RUNTIME_EVENT_AGENT_PROXY_LOG",
    systemLog: "NOOBOT_RUNTIME_EVENT_SYSTEM_LOG",
    stateMachineDebug: "NOOBOT_RUNTIME_EVENT_STATE_MACHINE_DEBUG",
    resendDebug: "NOOBOT_RUNTIME_EVENT_RESEND_DEBUG",
    stopDebug: "NOOBOT_RUNTIME_EVENT_STOP_DEBUG",
    sessionLogWsDebug: "NOOBOT_RUNTIME_EVENT_SESSION_LOG_WS_DEBUG",
    frontendStopContinueDebug: "NOOBOT_RUNTIME_EVENT_FRONTEND_STOP_CONTINUE_DEBUG",
    frontendReconnectTimingDebug: "NOOBOT_RUNTIME_EVENT_FRONTEND_RECONNECT_TIMING_DEBUG",
    agentProxyRouteDebug: "NOOBOT_RUNTIME_EVENT_AGENT_PROXY_ROUTE_DEBUG",
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
  sessionLogControls: {
    stateLog: true,
    messageLog: true,
    interactionLog: true,
    transportLog: true,
    agentProxyLog: true,
    systemLog: true,
    stateMachineDebug: false,
    resendDebug: false,
    stopDebug: false,
    sessionLogWsDebug: false,
    frontendStopContinueDebug: true,
    frontendReconnectTimingDebug: true,
    agentProxyRouteDebug: false,
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

function resolveBooleanEnv(env, name, fallback) {
  const raw = env?.[name];
  if (raw === undefined || raw === "") return fallback;
  const value = String(raw).trim().toLowerCase();
  if (["1", "true", "on", "yes", "enabled"].includes(value)) return true;
  if (["0", "false", "off", "no", "disabled"].includes(value)) return false;
  return fallback;
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

export function resolveRuntimeEventsSessionLogControls(env = process.env, overrides = {}) {
  const defaults = RUNTIME_EVENTS_CONFIG_DEFAULTS.sessionLogControls;
  const envs = RUNTIME_EVENTS_CONFIG_ENVS.sessionLogControls;
  const result = {};
  for (const key of Object.keys(defaults)) {
    result[key] = overrides[key] ?? resolveBooleanEnv(env, envs[key], defaults[key]);
  }
  return result;
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
