/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RunConfigPluginPreparer } from "./run-config-plugin-preparer.js";
export function createRunConfigPluginPreparer({
  globalConfig = {},
  workspaceService = null,
  loadedPlugins = null,
  pluginRuntime = {},
  normalizeStringArray = null,
  mergePluginOptions = null,
  createPluginResolveModelMessages = null,
  createDetachedSubSessionRunner = null,
  createGeneratedArtifactPersister = null,
} = {}) {
  return new RunConfigPluginPreparer({
    globalConfig,
    workspaceService,
    loadedDynamicPlugins: loadedPlugins,
    pluginRuntime,
    normalizeStringArray,
    mergePluginOptions,
    createPluginResolveModelMessages,
    createDetachedSubSessionRunner,
    createGeneratedArtifactPersister,
  });
}
