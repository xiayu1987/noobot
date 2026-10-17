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
  createPluginResolveModelMessages = null,
  createDetachedSubSessionRunner = null,
} = {}) {
  return new RunConfigPluginPreparer({
    globalConfig,
    workspaceService,
    loadedDynamicPlugins: loadedPlugins,
    createPluginResolveModelMessages,
    createDetachedSubSessionRunner,
  });
}
