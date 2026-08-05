/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createPluginActivationResult, PLUGIN_SURFACE } from "@noobot/plugin-protocol";
import { createHarnessRegistration } from "../core/plugin.js";
import { createRegisterHarnessHooks } from "../core/hooks.js";

const registerAgentHooks = createRegisterHarnessHooks({ sessionCleanupPoints: [] });
const registerAgentPlugin = createHarnessRegistration({ registerHarnessHooks: registerAgentHooks });

export function activate(host = {}, config = {}) {
  const registration = registerAgentPlugin({
    hookManager: { on: host?.hooks?.register, emit: host?.hooks?.emit },
    policy: host?.policy,
  }, config);
  return createPluginActivationResult({
    pluginId: "harness",
    surface: PLUGIN_SURFACE.AGENT,
    dispose: () => registration.disposers.forEach((dispose) => dispose()),
  });
}
