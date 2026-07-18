/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { PLUGIN_SLOT_KEY } from "../../../plugin/plugin-constants.js";

export function buildSessionRuntimePluginResolvedEvent(runConfig = {}) {
  const agentPluginOptions = resolveRuntimePluginOptions({
    runConfig,
    managerKey: "hookManager",
    hooksKey: "hooks",
    runtimeKeys: [PLUGIN_SLOT_KEY.AGENT],
    pluginKeys: [PLUGIN_SLOT_KEY.AGENT],
  });
  const botPluginOptions = resolveRuntimePluginOptions({
    runConfig,
    managerKey: "botHookManager",
    hooksKey: "botHooks",
    runtimeKeys: [PLUGIN_SLOT_KEY.BOT],
    pluginKeys: [PLUGIN_SLOT_KEY.BOT],
  });
  return {
    selectedPlugins: Array.isArray(runConfig?.selectedPlugins) ? runConfig.selectedPlugins : [],
    agentPlugin: buildRuntimePluginState(agentPluginOptions),
    botPlugin: buildRuntimePluginState(botPluginOptions),
  };
}

function resolveRuntimePluginOptions({ runConfig = {}, managerKey = "", hooksKey = "", runtimeKeys = [], pluginKeys = [] } = {}) {
  const managers = [runConfig?.[managerKey], runConfig?.[hooksKey]].filter(
    (item) => item && typeof item === "object",
  );
  for (const manager of managers) {
    const runtime = manager?.runtime && typeof manager.runtime === "object" ? manager.runtime : {};
    for (const runtimeKey of runtimeKeys) {
      const options = runtime?.[runtimeKey];
      if (options && typeof options === "object") return options;
    }
  }
  const plugins = runConfig?.plugins && typeof runConfig.plugins === "object" ? runConfig.plugins : {};
  for (const pluginKey of pluginKeys) {
    const options = plugins?.[pluginKey];
    if (options && typeof options === "object") return options;
  }
  return {};
}

function buildRuntimePluginState(options = {}) {
  return {
    enabled: options?.enabled === true,
    mode: String(options?.mode || "").trim().toLowerCase(),
  };
}
