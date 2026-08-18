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
import { EXTENSION_POINTS } from "@noobot/plugin-protocol/frontend";
import { validateProtocolEvent } from "@noobot/event-protocol";

export function routeRuntimeStreamEvent(envelope = {}, context = {}) {
  const validation = validateProtocolEvent(envelope);
  if (!validation.valid) return false;
  const registered = listExtensionContributions(EXTENSION_POINTS.RUNTIME_STREAM_ROUTE);
  const projectionContext = {
    envelope,
    descriptor: validation.descriptor,
    context,
  };
  const matched = resolveExtensionPoint(EXTENSION_POINTS.RUNTIME_STREAM_ROUTE, projectionContext);
  const routes = provideResolvedExtensionValues(matched, projectionContext);
  const buildProjectionDiagnostics = (extra = {}) => ({
    sessionId: String(
      envelope?.payload?.route?.rootSessionId ||
        envelope?.payload?.parentSessionId ||
        envelope?.identity?.sessionId ||
        context?.sessionId ||
        "",
    ),
    dialogProcessId: String(envelope?.payload?.dialogProcessId || ""),
    turnScopeId: String(envelope?.identity?.turnScopeId || context?.turnScopeId || ""),
    eventType: String(envelope?.identity?.eventType || ""),
    eventFamily: String(envelope?.protocol?.family || ""),
    source: String(context?.source || "unknown"),
    ...extra,
  });
  context?.logRuntimeProjectionDiagnostics?.("frontend.pluginRuntime.gatewayEvaluated", {
    ...buildProjectionDiagnostics(),
    registeredContributionIds: registered.map((item) => item.id),
    matchedContributionIds: matched.map((item) => item.id),
    projectorCount: routes.filter((route) => typeof route === "function").length,
  });
  for (const route of routes) {
    if (typeof route !== "function") continue;
    try {
      if (route({ envelope, descriptor: validation.descriptor, context }) === true) return true;
    } catch (error) {
      context?.logRuntimeProjectionDiagnostics?.("frontend.pluginRuntime.projectorFailed", {
        ...buildProjectionDiagnostics(),
        error: String(error?.message || error || ""),
      });
      console.warn(`[runtime-stream-router] route failed: ${error?.message || error}`);
    }
  }
  return false;
}
