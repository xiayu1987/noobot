/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { PLUGIN_SLOT_KEY } from "../../../extensions/plugins/plugin-constants.js";

export function buildSessionRuntimePluginResolvedEvent(runConfig = {}) {
  const agentPluginOptions = resolveRuntimePluginOptions({
    runConfig,
    pluginKeys: [PLUGIN_SLOT_KEY.AGENT],
  });
  const botPluginOptions = resolveRuntimePluginOptions({
    runConfig,
    pluginKeys: [PLUGIN_SLOT_KEY.BOT],
  });
  return {
    selectedPlugins: Array.isArray(runConfig?.selectedPlugins) ? runConfig.selectedPlugins : [],
    agentPlugin: buildRuntimePluginState(agentPluginOptions),
    botPlugin: buildRuntimePluginState(botPluginOptions),
  };
}

function resolveRuntimePluginOptions({ runConfig = {}, pluginKeys = [] } = {}) {
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
