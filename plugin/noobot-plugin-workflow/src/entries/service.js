/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createPluginActivationResult, PLUGIN_SURFACE } from "@noobot/plugin-protocol";
import { normalizeOptions } from "../core/options.js";
import { registerWorkflowServiceHooks } from "../core/orchestrator.js";
import { createWorkflowServiceRouteHandlers } from "../service/routes.js";

export function activate(host = {}, config = {}) {
  const options = normalizeOptions(config);
  const disposers = registerWorkflowServiceHooks({
    hookManager: { on: host?.hooks?.register, emit: host?.hooks?.emit },
    options,
  });
  const handlers = createWorkflowServiceRouteHandlers({ ports: host?.ports });
  for (const [routeId, handler] of Object.entries(handlers)) host?.routes?.bind(routeId, handler);
  return createPluginActivationResult({
    pluginId: "workflow",
    surface: PLUGIN_SURFACE.SERVICE,
    dispose: () => disposers.forEach((dispose) => dispose()),
  });
}
