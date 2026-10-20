/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RunConfigPluginPreparer } from "./run-config-plugin-preparer.js";

export function createRunConfigPluginPreparer({
  globalConfig,
  workspaceService,
  loadedPlugins,
  createPluginResolveModelMessages,
  createDetachedSubSessionRunner,
}) {
  return new RunConfigPluginPreparer({
    globalConfig,
    workspaceService,
    loadedDynamicPlugins: loadedPlugins,
    createPluginResolveModelMessages,
    createDetachedSubSessionRunner,
  });
}
