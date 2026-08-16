/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isPlainObject } from "../utils.js";
import { normalizePluginIds, resolvePluginSelection } from "../normalization/plugin-selection.js";

export function mergeRunConfigPluginPolicy({ baseRunConfig = {}, runConfigPatch = {}, disabledPlugins = [] } = {}) {
  const merged = {
    ...(isPlainObject(baseRunConfig) ? baseRunConfig : {}),
    ...(isPlainObject(runConfigPatch) ? runConfigPatch : {}),
  };
  const disabled = normalizePluginIds([...(merged.disabledPlugins || []), ...disabledPlugins]);
  const selection = resolvePluginSelection({
    selectedPlugins: merged.selectedPlugins,
    disabledPlugins: disabled,
    mode: merged.pluginPolicy?.mode,
  });
  return {
    ...merged,
    selectedPlugins: selection.selectedPlugins,
    disabledPlugins: selection.disabledPlugins,
    ...(selection.pluginsDisabled ? { plugins: {} } : {}),
  };
}
