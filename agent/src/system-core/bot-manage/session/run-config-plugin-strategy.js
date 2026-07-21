/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeTrimmedStringList } from "./session-execution-engine-utils.js";

/**
 * 合并基础 runConfig 与补丁，并按 disabledPlugins 剪除 selectedPlugins、
 * 将对应 plugins 项标记为 enabled:false / mode:"off"。纯函数，无 engine 依赖。
 */
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
  // Keep the strategy-level deny list in the run config. Detached sessions can
  // pass through run-config preparation more than once; the plugin options
  // object alone is not a durable deny signal because preparation may rebuild
  // plugins from user/global configuration.
  merged.disabledPlugins = Array.from(new Set([
    ...normalizeTrimmedStringList(merged?.disabledPlugins),
    ...disabledSet,
  ]));
  const selectedPlugins = Array.isArray(merged?.selectedPlugins)
    ? merged.selectedPlugins
    : [];
  merged.selectedPlugins = normalizeTrimmedStringList(selectedPlugins)
    .filter((item) => !disabledSet.has(item));
  const plugins = merged?.plugins && typeof merged.plugins === "object" ? merged.plugins : {};
  const nextPlugins = { ...plugins };
  for (const pluginName of disabledSet) {
    const current =
      nextPlugins?.[pluginName] && typeof nextPlugins[pluginName] === "object"
        ? nextPlugins[pluginName]
        : {};
    nextPlugins[pluginName] = {
      ...current,
      enabled: false,
      mode: "off",
    };
  }
  merged.plugins = nextPlugins;
  return merged;
}
