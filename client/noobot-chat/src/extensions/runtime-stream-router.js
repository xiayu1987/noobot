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
import {
  EXTENSION_POINTS,
  requireRuntimeStreamRouteContext,
} from "@noobot/plugin-protocol/frontend";
import { validateProtocolEvent } from "@noobot/event-protocol";
import { logPluginRuntimeDiagnostics } from "../modules/debug/loggers/pluginRuntimeDiagnosticsLogger.js";
import { isFunction } from "@noobot/shared/value";

function executeRuntimeRoutes(
  routes,
  envelope,
  descriptor,
  context,
  buildDiagnostics,
  logDiagnostics,
) {
  for (const route of routes) {
    try {
      if (route({ envelope, descriptor, context }) === true) return true;
    } catch (error) {
      logDiagnostics("frontend.pluginRuntime.projectorFailed", {
        ...buildDiagnostics(),
        error: String(error?.message || error || ""),
      });
      console.warn(`[runtime-stream-router] route failed: ${error?.message || error}`);
    }
  }
  return false;
}

function buildProjectionDiagnostics(envelope, context, extra = {}) {
  return {
    sessionId: envelope.identity.sessionId,
    dialogProcessId: envelope.payload.dialogProcessId,
    turnScopeId: envelope.identity.turnScopeId,
    eventType: envelope.identity.eventType,
    eventFamily: envelope.protocol.family,
    source: context.source,
    ...extra,
  };
}

export function routeRuntimeStreamEvent(envelope, context) {
  const validation = validateProtocolEvent(envelope);
  if (!validation.valid) return false;
  requireRuntimeStreamRouteContext(context);
  const logDiagnostics = context.logRuntimeProjectionDiagnostics ?? logPluginRuntimeDiagnostics;
  const registered = listExtensionContributions(EXTENSION_POINTS.RUNTIME_STREAM_ROUTE);
  const projectionContext = {
    envelope,
    descriptor: validation.descriptor,
    context,
  };
  const matched = resolveExtensionPoint(EXTENSION_POINTS.RUNTIME_STREAM_ROUTE, projectionContext);
  const routes = provideResolvedExtensionValues(matched, projectionContext);
  logDiagnostics("frontend.pluginRuntime.gatewayEvaluated", {
    ...buildProjectionDiagnostics(envelope, context),
    registeredContributionIds: registered.map((item) => item.id),
    matchedContributionIds: matched.map((item) => item.id),
    projectorCount: routes.filter((route) => isFunction(route)).length,
  });
  return executeRuntimeRoutes(
    routes,
    envelope,
    validation.descriptor,
    context,
    (extra = {}) => buildProjectionDiagnostics(envelope, context, extra),
    logDiagnostics,
  );
}
