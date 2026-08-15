/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeTrimmedStringList } from "./session-execution-engine-utils.js";

export function mergeRunConfigWithPluginStrategy({
  baseRunConfig = {},
  runConfigPatch = {},
  disabledPlugins = [],
} = {}) {
  const merged = {
    ...(baseRunConfig && typeof baseRunConfig === "object" ? baseRunConfig : {}),
    ...(runConfigPatch && typeof runConfigPatch === "object" ? runConfigPatch : {}),
  };
  const disabledSet = new Set(normalizeTrimmedStringList(disabledPlugins));
  if (!disabledSet.size) return merged;
  merged.disabledPlugins = Array.from(new Set([
    ...normalizeTrimmedStringList(merged?.disabledPlugins),
    ...disabledSet,
  ]));
  const selectedPlugins = Array.isArray(merged?.selectedPlugins)
    ? merged.selectedPlugins
    : [];
  merged.selectedPlugins = normalizeTrimmedStringList(selectedPlugins)
    .filter((item) => !disabledSet.has(item));
  return merged;
}
