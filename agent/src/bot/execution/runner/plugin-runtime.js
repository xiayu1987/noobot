/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function buildSessionRuntimePluginResolvedEvent(runConfig = {}) {
  const selectedPlugins = Array.isArray(runConfig?.selectedPlugins) ? runConfig.selectedPlugins : [];
  const plugins = runConfig?.plugins && typeof runConfig.plugins === "object" ? runConfig.plugins : {};
  return {
    selectedPlugins,
    plugins: Object.fromEntries(selectedPlugins.map((pluginId) => [pluginId, {
      enabled: plugins?.[pluginId]?.enabled === true,
      mode: String(plugins?.[pluginId]?.mode || "").trim().toLowerCase(),
    }])),
  };
}
