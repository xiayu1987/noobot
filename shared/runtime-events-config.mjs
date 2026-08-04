/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
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
    log: {
      state: "NOOBOT_RUNTIME_EVENT_STATE_LOG",
      message: "NOOBOT_RUNTIME_EVENT_MESSAGE_LOG",
      interaction: "NOOBOT_RUNTIME_EVENT_INTERACTION_LOG",
      transport: "NOOBOT_RUNTIME_EVENT_TRANSPORT_LOG",
      agentProxy: "NOOBOT_RUNTIME_EVENT_AGENT_PROXY_LOG",
      system: "NOOBOT_RUNTIME_EVENT_SYSTEM_LOG",
      frontendLifecycle: "NOOBOT_RUNTIME_EVENT_FRONTEND_LIFECYCLE_LOG",
      agentProxyHttp: "NOOBOT_RUNTIME_EVENT_AGENT_PROXY_HTTP_LOG",
      agentProxyWebSocket: "NOOBOT_RUNTIME_EVENT_AGENT_PROXY_WEBSOCKET_LOG",
      agentProxyRoute: "NOOBOT_RUNTIME_EVENT_AGENT_PROXY_ROUTE_LOG",
      backendWebSocket: "NOOBOT_RUNTIME_EVENT_BACKEND_WEBSOCKET_LOG",
      backendLifecycle: "NOOBOT_RUNTIME_EVENT_BACKEND_LIFECYCLE_LOG",
    },
    debug: {
      stateMachine: "NOOBOT_RUNTIME_EVENT_STATE_MACHINE_DEBUG",
      resend: "NOOBOT_RUNTIME_EVENT_RESEND_DEBUG",
      stop: "NOOBOT_RUNTIME_EVENT_STOP_DEBUG",
      sessionLogWs: "NOOBOT_RUNTIME_EVENT_SESSION_LOG_WS_DEBUG",
      frontendStopContinue: "NOOBOT_RUNTIME_EVENT_FRONTEND_STOP_CONTINUE_DEBUG",
      frontendReconnectTiming: "NOOBOT_RUNTIME_EVENT_FRONTEND_RECONNECT_TIMING_DEBUG",
      frontendThinkingReplay: "NOOBOT_RUNTIME_EVENT_FRONTEND_THINKING_REPLAY_DEBUG",
      timelinePipeline: "NOOBOT_RUNTIME_EVENT_TIMELINE_PIPELINE_DEBUG",
      frontendToolLogWindow: "NOOBOT_RUNTIME_EVENT_FRONTEND_TOOL_LOG_WINDOW_DEBUG",
      frontendTerminalResolution: "NOOBOT_RUNTIME_EVENT_FRONTEND_TERMINAL_RESOLUTION_DEBUG",
      agentProxyRoute: "NOOBOT_RUNTIME_EVENT_AGENT_PROXY_ROUTE_DEBUG",
      workflowDiagnostics: "NOOBOT_RUNTIME_EVENT_WORKFLOW_DIAGNOSTICS_DEBUG",
      contextIdentity: "NOOBOT_RUNTIME_EVENT_CONTEXT_IDENTITY_DEBUG",
      agentContext: "NOOBOT_RUNTIME_EVENT_AGENT_CONTEXT_DEBUG",
    },
  },
  hookRuntimeEvents: {
    mode: "NOOBOT_HOOK_RUNTIME_EVENTS_MODE",
  },
  executionLogControls: {
    sessionTurnFullDebug: "NOOBOT_RUNTIME_EVENT_SESSION_TURN_FULL_DEBUG",
    messagePersistenceSuccessDebug: "NOOBOT_RUNTIME_EVENT_MESSAGE_PERSISTENCE_SUCCESS_DEBUG",
  },
});

export const RUNTIME_EVENTS_CONFIG_DEFAULTS = deepFreeze({
  runtimeEvents: {
    maxFileBytes: 5 * 1024 * 1024,
    retentionDays: 7,
    maxArchives: 20,
  },
  sessionLogControls: {
    log: {
      state: true,
      message: true,
      interaction: true,
      transport: true,
      agentProxy: true,
      system: true,
      frontendLifecycle: true,
      agentProxyHttp: true,
      agentProxyWebSocket: true,
      agentProxyRoute: true,
      backendWebSocket: true,
      backendLifecycle: true,
    },
    debug: {
      stateMachine: false,
      resend: false,
      stop: false,
      sessionLogWs: false,
      frontendStopContinue: false,
      frontendReconnectTiming: false,
      frontendThinkingReplay: false,
      timelinePipeline: false,
      frontendToolLogWindow: false,
      frontendTerminalResolution: false,
      agentProxyRoute: false,
      workflowDiagnostics: false,
      contextIdentity: true,
      agentContext: true,
    },
  },
  hookRuntimeEvents: {
    mode: "summary",
  },
  executionLogControls: {
    sessionTurnFullDebug: false,
    messagePersistenceSuccessDebug: false,
  },
});

export const RUNTIME_EVENTS_EXECUTION_LOG_EVENT_CONTROLS = deepFreeze({
  session_turn_full: "sessionTurnFullDebug",
  assistant_message_saved: "messagePersistenceSuccessDebug",
  tool_message_saved: "messagePersistenceSuccessDebug",
});

export const RUNTIME_EVENTS_SESSION_LOG_CONTROL_KEYS = deepFreeze({
  state: "state",
  message: "message",
  interaction: "interaction",
  transport: "transport",
  "agent-proxy": "agentProxy",
  system: "system",
  "frontend-lifecycle": "frontendLifecycle",
  "agent-proxy-http": "agentProxyHttp",
  "agent-proxy-websocket": "agentProxyWebSocket",
  "agent-proxy-route": "agentProxyRoute",
  "backend-websocket": "backendWebSocket",
  "backend-lifecycle": "backendLifecycle",
});

export const RUNTIME_EVENTS_SESSION_LOG_DEBUG_TYPES = deepFreeze({
  "state-machine": { controlKey: "stateMachine", exposeToClient: true },
  resend: { controlKey: "resend", exposeToClient: true },
  stop: { controlKey: "stop", exposeToClient: true },
  "session-log-ws": { controlKey: "sessionLogWs", exposeToClient: false },
  "stop-continue": { controlKey: "frontendStopContinue", exposeToClient: true },
  "reconnect-timing": { controlKey: "frontendReconnectTiming", exposeToClient: true },
  "thinking-replay": { controlKey: "frontendThinkingReplay", exposeToClient: true },
  "timeline-pipeline": { controlKey: "timelinePipeline", exposeToClient: false },
  "tool-log-window": { controlKey: "frontendToolLogWindow", exposeToClient: true },
  "terminal-resolution": { controlKey: "frontendTerminalResolution", exposeToClient: true },
  "agent-proxy-route": { controlKey: "agentProxyRoute", exposeToClient: false },
  "workflow-diagnostics": { controlKey: "workflowDiagnostics", exposeToClient: true },
  "context-identity": { controlKey: "contextIdentity", exposeToClient: false },
  "agent-context": { controlKey: "agentContext", exposeToClient: false },
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
  const result = { log: {}, debug: {} };
  for (const domain of ["log", "debug"]) {
    for (const key of Object.keys(defaults[domain])) {
      result[domain][key] = overrides?.[domain]?.[key]
        ?? resolveBooleanEnv(env, envs[domain][key], defaults[domain][key]);
    }
  }
  return result;
}

export function resolveRuntimeEventsExecutionLogControls(env = process.env, overrides = {}) {
  const defaults = RUNTIME_EVENTS_CONFIG_DEFAULTS.executionLogControls;
  const envs = RUNTIME_EVENTS_CONFIG_ENVS.executionLogControls;
  const result = {};
  for (const key of Object.keys(defaults)) {
    result[key] = overrides[key] ?? resolveBooleanEnv(env, envs[key], defaults[key]);
  }
  return result;
}

export function shouldRecordRuntimeExecutionLog(event = {}, options = {}) {
  if (event && typeof event === "object") {
    const level = String(event?.level || "").trim().toLowerCase();
    const category = String(event?.category || "").trim().toLowerCase();
    const status = String(event?.status || event?.data?.status || "").trim().toLowerCase();
    if (
      ["warn", "error", "fatal"].includes(level)
      || ["warn", "error", "fatal"].includes(category)
      || ["failed", "failure", "error"].includes(status)
      || event?.success === false
      || event?.data?.success === false
      || Boolean(event?.error || event?.data?.error)
    ) {
      return true;
    }
  }
  if (String(event?.category || "").trim().toLowerCase() === "context_identity") {
    const controls = resolveRuntimeEventsSessionLogControls(
      options.env || process.env,
      options.sessionLogControls || {},
    );
    return controls.debug.contextIdentity === true;
  }
  if (String(event?.category || "").trim().toLowerCase() === "agent_context") {
    const controls = resolveRuntimeEventsSessionLogControls(
      options.env || process.env,
      options.sessionLogControls || {},
    );
    return controls.debug.agentContext === true;
  }
  const eventName = String(
    typeof event === "string" ? event : event?.event || event?.name || "",
  ).trim().toLowerCase();
  const controlKey = RUNTIME_EVENTS_EXECUTION_LOG_EVENT_CONTROLS[eventName];
  if (!controlKey) return true;
  const controls = resolveRuntimeEventsExecutionLogControls(
    options.env || process.env,
    options.executionLogControls || options.controls || options,
  );
  return controls[controlKey] === true;
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
