/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { normalizeStringList } from "../utils.js";

export function normalizePluginIds(input = []) {
  return normalizeStringList(input, { dedupe: true });
}

export function resolvePluginSelection({
  selectedPlugins = [],
  disabledPlugins = [],
  mode = "",
} = {}) {
  const disabled = normalizePluginIds(disabledPlugins);
  const pluginsDisabled =
    String(mode || "")
      .trim()
      .toLowerCase() === "none";
  if (pluginsDisabled) {
    return {
      selectedPlugins: [],
      disabledPlugins: disabled,
      enabledPluginIds: [],
      pluginsDisabled,
    };
  }
  const disabledSet = new Set(disabled);
  const selected = normalizePluginIds(selectedPlugins).filter((id) => !disabledSet.has(id));
  return {
    selectedPlugins: selected,
    disabledPlugins: disabled,
    enabledPluginIds: selected,
    pluginsDisabled,
  };
}

export function readPluginSelectionInput(runConfig = {}) {
  const config = runConfig && typeof runConfig === "object" ? runConfig : {};
  return {
    selectedPlugins: config.selectedPlugins,
    disabledPlugins: config.disabledPlugins,
    mode: config.pluginPolicy?.mode,
  };
}
