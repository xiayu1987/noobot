/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  listExtensionContributions,
  provideResolvedExtensionValues,
  resolveExtensionPoint,
} from "./extension-registry.js";
import { EXTENSION_POINTS } from "./extension-point-ids.js";

const AUTHORITATIVE_STATE_EVENTS = new Set([
  "turn_lifecycle",
  "turn_snapshot",
  "execution_snapshot",
  "execution_children",
  "execution_tree",
]);

export function routeRuntimeStreamEvent(event = "", data = {}, context = {}) {
  if (AUTHORITATIVE_STATE_EVENTS.has(String(event || "").trim())) return false;
  const registered = listExtensionContributions(EXTENSION_POINTS.RUNTIME_STREAM_ROUTE);
  const projectionContext = {
    event,
    data,
    context,
  };
  const matched = resolveExtensionPoint(EXTENSION_POINTS.RUNTIME_STREAM_ROUTE, projectionContext);
  const routes = provideResolvedExtensionValues(matched, projectionContext);
  context?.logRuntimeProjectionDiagnostics?.("frontend.pluginRuntime.gatewayEvaluated", {
    sessionId: String(data?.route?.rootSessionId || data?.parentSessionId || data?.sessionId || context?.sessionId || ""),
    dialogProcessId: String(data?.dialogProcessId || ""),
    turnScopeId: String(data?.turnScopeId || context?.turnScopeId || ""),
    transportEvent: String(event || ""),
    source: String(context?.source || "unknown"),
    registeredContributionIds: registered.map((item) => item.id),
    matchedContributionIds: matched.map((item) => item.id),
    projectorCount: routes.filter((route) => typeof route === "function").length,
  });
  for (const route of routes) {
    if (typeof route !== "function") continue;
    try {
      if (route({ event, data, context }) === true) return true;
    } catch (error) {
      context?.logRuntimeProjectionDiagnostics?.("frontend.pluginRuntime.projectorFailed", {
        sessionId: String(data?.route?.rootSessionId || data?.parentSessionId || data?.sessionId || context?.sessionId || ""),
        dialogProcessId: String(data?.dialogProcessId || ""),
        turnScopeId: String(data?.turnScopeId || context?.turnScopeId || ""),
        transportEvent: String(event || ""),
        source: String(context?.source || "unknown"),
        error: String(error?.message || error || ""),
      });
      console.warn(`[runtime-stream-router] route failed: ${error?.message || error}`);
    }
  }
  return false;
}
