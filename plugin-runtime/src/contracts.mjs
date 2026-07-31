/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const PLUGIN_RUNTIME_SURFACE = Object.freeze({
  AGENT: "agent",
  SERVICE: "service",
  FRONTEND: "frontend",
});

export const PLUGIN_CAPABILITY = Object.freeze({
  AGENT_REGISTER: "agent.register",
  AGENT_EXECUTION_INTENT: "agent.execution_intent",
  BOT_REGISTER: "bot.register",
  SERVICE_HTTP_ROUTES: "service.http_routes",
  SERVICE_AFTER_SESSION_DELETE: "service.after_session_delete",
  FRONTEND_RUNTIME_PROJECTION: "frontend.runtime_projection",
});

export const PLUGIN_CAPABILITIES = Object.freeze(Object.values(PLUGIN_CAPABILITY));

export const PLUGIN_CAPABILITY_SURFACE = Object.freeze({
  [PLUGIN_CAPABILITY.AGENT_REGISTER]: PLUGIN_RUNTIME_SURFACE.AGENT,
  [PLUGIN_CAPABILITY.BOT_REGISTER]: PLUGIN_RUNTIME_SURFACE.AGENT,
  [PLUGIN_CAPABILITY.SERVICE_HTTP_ROUTES]: PLUGIN_RUNTIME_SURFACE.SERVICE,
  [PLUGIN_CAPABILITY.SERVICE_AFTER_SESSION_DELETE]: PLUGIN_RUNTIME_SURFACE.SERVICE,
  [PLUGIN_CAPABILITY.FRONTEND_RUNTIME_PROJECTION]: PLUGIN_RUNTIME_SURFACE.FRONTEND,
});

export function normalizePluginCapabilities(capabilities = []) {
  return Array.from(
    new Set(
      (Array.isArray(capabilities) ? capabilities : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    ),
  );
}

export function resolveCapabilityRuntimeSurface(capability = "") {
  const normalized = String(capability || "").trim();
  if (!normalized) return "";
  if (PLUGIN_CAPABILITY_SURFACE[normalized]) return PLUGIN_CAPABILITY_SURFACE[normalized];
  if (normalized.startsWith("agent.") || normalized.startsWith("bot.")) {
    return PLUGIN_RUNTIME_SURFACE.AGENT;
  }
  if (normalized.startsWith("service.")) return PLUGIN_RUNTIME_SURFACE.SERVICE;
  if (normalized.startsWith("frontend.")) return PLUGIN_RUNTIME_SURFACE.FRONTEND;
  return "";
}
