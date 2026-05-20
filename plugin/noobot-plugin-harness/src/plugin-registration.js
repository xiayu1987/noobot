/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { cleanupOldRuns } from "./lib/cleanup.js";

import { PLUGIN_NAME, PLUGIN_VERSION } from "./constants.js";
import { extractBasePath } from "./runtime-context.js";
import { assertHookManager, createPluginRuntimeContext } from "./plugin-runtime-context.js";
import { registerHarnessHooks } from "./register-hooks.js";

export function createRegisterNoobotPlugin(deps = {}) {
  const createPluginRuntimeContextFn = deps.createPluginRuntimeContext || createPluginRuntimeContext;
  const assertHookManagerFn = deps.assertHookManager || assertHookManager;
  const extractBasePathFn = deps.extractBasePath || extractBasePath;
  const cleanupOldRunsFn = deps.cleanupOldRuns || cleanupOldRuns;
  const registerHarnessHooksFn = deps.registerHarnessHooks || registerHarnessHooks;

  return function registerNoobotPlugin(api = {}, userOptions = {}) {
    const { options, hookManager, capabilityRuntime } = createPluginRuntimeContextFn(api, userOptions);
    assertHookManagerFn(hookManager);
    if (!options.enabled) return { name: PLUGIN_NAME, version: PLUGIN_VERSION, disposers: [] };

    const basePath = extractBasePathFn({}, options);
    if (basePath) {
      cleanupOldRunsFn(basePath, options).catch(() => {});
    }
    const disposers = registerHarnessHooksFn({
      hookManager,
      options,
      capabilityRuntime,
      plugin: { name: PLUGIN_NAME, version: PLUGIN_VERSION },
    });

    return { name: PLUGIN_NAME, version: PLUGIN_VERSION, disposers };
  };
}

export const registerNoobotPlugin = createRegisterNoobotPlugin();
