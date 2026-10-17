/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createPluginActivationResult, PLUGIN_SURFACE } from "@noobot/plugin-protocol";
import { PLUGIN_ID } from "../core/constants.js";
import { registerWorkflowServiceHooks } from "../core/orchestrator.js";
import { createWorkflowServiceRouteHandlers } from "../service/routes.js";

export function activate(host, config) {
  const disposers = registerWorkflowServiceHooks({
    hookManager: { on: host.hooks.register, emit: host.hooks.emit },
    config,
  });
  const handlers = createWorkflowServiceRouteHandlers({ ports: host.ports });
  for (const [routeId, handler] of Object.entries(handlers)) host.routes.bind(routeId, handler);
  return createPluginActivationResult({
    pluginId: PLUGIN_ID,
    surface: PLUGIN_SURFACE.SERVICE,
    dispose: () => disposers.forEach((dispose) => dispose()),
  });
}
