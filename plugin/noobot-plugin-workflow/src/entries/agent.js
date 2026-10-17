/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createPluginActivationResult, PLUGIN_SURFACE } from "@noobot/plugin-protocol";
import { PLUGIN_ID } from "../core/constants.js";
import { registerWorkflowAgentHooks } from "../core/orchestrator.js";

export function activate(host, config) {
  const disposers = registerWorkflowAgentHooks({
    hookManager: { on: host.hooks.register, emit: host.hooks.emit },
    policy: host.policy,
    config,
  });
  return createPluginActivationResult({
    pluginId: PLUGIN_ID,
    surface: PLUGIN_SURFACE.AGENT,
    dispose: () => disposers.forEach((dispose) => dispose()),
  });
}
