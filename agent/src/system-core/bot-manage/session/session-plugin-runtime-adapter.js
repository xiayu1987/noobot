/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RunConfigPluginPreparer } from "./run-config-plugin-preparer.js";
import { normalizePluginSelectorSet } from "./session-execution-engine-utils.js";

export function createSessionPluginRuntime({
  loadedPlugins = null,
  descriptors = [],
  resolvePluginKey = null,
} = {}) {
  const runtime = {};
  for (const descriptor of Array.isArray(descriptors) ? descriptors : []) {
    if (!descriptor || typeof descriptor !== "object") continue;
    const keyProperty = String(descriptor.keyProperty || "").trim();
    const selectorsProperty = String(descriptor.selectorsProperty || "").trim();
    const modelConfigKeysProperty = String(descriptor.modelConfigKeysProperty || "").trim();
    if (!keyProperty || !selectorsProperty) continue;

    const fallbackKey = String(descriptor.fallbackKey || "").trim();
    const resolvedKey =
      typeof resolvePluginKey === "function"
        ? String(resolvePluginKey({ loadedPlugins, descriptor }) || "").trim()
        : "";
    const pluginKey = resolvedKey || fallbackKey;
    runtime[keyProperty] = pluginKey;
    runtime[selectorsProperty] = normalizePluginSelectorSet([
      pluginKey,
      fallbackKey,
      ...(Array.isArray(descriptor.selectors) ? descriptor.selectors : []),
    ]);
    if (modelConfigKeysProperty) {
      const resolvedModelConfigKeys =
        typeof descriptor.resolveModelConfigKeys === "function"
          ? descriptor.resolveModelConfigKeys({ loadedPlugins, descriptor, pluginKey })
          : [];
      runtime[modelConfigKeysProperty] = normalizePluginSelectorSet([
        pluginKey,
        fallbackKey,
        ...(Array.isArray(resolvedModelConfigKeys) ? resolvedModelConfigKeys : []),
        ...(Array.isArray(descriptor.modelConfigKeys) ? descriptor.modelConfigKeys : []),
      ]);
    }
  }
  return Object.freeze(runtime);
}

export function createRunConfigPluginPreparer({
  globalConfig = {},
  workspaceService = null,
  loadedPlugins = null,
  pluginRuntime = {},
  normalizeStringArray = null,
  mergePluginOptions = null,
  createPluginResolveModelMessages = null,
  createPluginMarkMessagesSummarized = null,
  createDetachedSubSessionRunner = null,
  createGeneratedArtifactPersister = null,
  createScopedJsonWriter = null,
  createScopedEventLogger = null,
} = {}) {
  return new RunConfigPluginPreparer({
    globalConfig,
    workspaceService,
    loadedDynamicPlugins: loadedPlugins,
    pluginRuntime,
    normalizeStringArray,
    mergePluginOptions,
    createPluginResolveModelMessages,
    createPluginMarkMessagesSummarized,
    createDetachedSubSessionRunner,
    createGeneratedArtifactPersister,
    createScopedJsonWriter,
    createScopedEventLogger,
  });
}
