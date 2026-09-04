/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "../utils.js";
import { readPluginSelectionInput, resolvePluginSelection } from "../normalization/plugin-selection.js";

export function createPluginConfigPlan({ runConfig = {}, effectiveConfig = {}, manifests = [] } = {}) {
  const selection = resolvePluginSelection(readPluginSelectionInput(runConfig));
  const selectedSet = new Set(selection.enabledPluginIds);
  return {
    ...selection,
    plugins: manifests
      .filter((manifest) => selectedSet.has(String(manifest?.pluginId || "").trim()))
      .filter((manifest) => effectiveConfig?.plugins?.[manifest.pluginId]?.enabled !== false)
      .map((manifest) => ({
        pluginId: manifest.pluginId,
        options: Object.assign(
          {},
          isPlainObject(manifest.defaults) ? manifest.defaults : {},
          isPlainObject(effectiveConfig?.plugins?.[manifest.pluginId]) ? effectiveConfig.plugins[manifest.pluginId] : {},
          isPlainObject(runConfig?.plugins?.[manifest.pluginId]) ? runConfig.plugins[manifest.pluginId] : {},
          isPlainObject(runConfig?.pluginModelConfig?.[manifest.pluginId]) ? runConfig.pluginModelConfig[manifest.pluginId] : {},
        ),
      })),
  };
}
