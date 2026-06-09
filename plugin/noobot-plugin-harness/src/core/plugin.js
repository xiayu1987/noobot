/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { cleanupOldRuns } from "../utils/cleanup.js";
import { assertHookManager, createPluginRuntimeContext } from "./context.js";
import { PLUGIN_NAME, PLUGIN_VERSION } from "./constants.js";
import { registerHarnessHooks } from "./hooks.js";
import { normalizeOptions } from "./options.js";
import { extractBasePath } from "./context.js";
import { formatHarnessCoreError, HARNESS_CORE_ERROR } from "./error-messages.js";

export function createRegisterNoobotPlugin(deps = {}) {
  const createPluginRuntimeContextFn = deps.createPluginRuntimeContext || createPluginRuntimeContext;
  const assertHookManagerFn = deps.assertHookManager || assertHookManager;
  const extractBasePathFn = deps.extractBasePath || extractBasePath;
  const cleanupOldRunsFn = deps.cleanupOldRuns || cleanupOldRuns;
  const registerHarnessHooksFn = deps.registerHarnessHooks || registerHarnessHooks;

  return function registerNoobotPlugin(api = {}, userOptions = {}) {
    const { options, hookManager, capabilityRuntime } = createPluginRuntimeContextFn(api, userOptions);
    const locale = String(options?.locale || "").trim() || "en-US";
    assertHookManagerFn(hookManager, { locale });
    if (!options.enabled) return { name: PLUGIN_NAME, version: PLUGIN_VERSION, disposers: [] };
    if (
      api?.policy &&
      typeof api.policy.appendDenyToolNames === "function" &&
      Array.isArray(options?.denyToolNames) &&
      options.denyToolNames.length
    ) {
      api.policy.appendDenyToolNames(options.denyToolNames);
    }

    const basePath = extractBasePathFn({}, options);
    if (basePath) {
      cleanupOldRunsFn(basePath, options).catch((error) => {
        console.warn(formatHarnessCoreError(HARNESS_CORE_ERROR.CLEANUP_OLD_RUNS_FAILED, {
          locale,
          params: {
            message: String(error?.message || error || ""),
          },
        }));
      });
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

export function createHarnessPluginFactory(deps = {}) {
  const normalizeOptionsFn = deps.normalizeOptions || normalizeOptions;
  const registerNoobotPluginFn = deps.registerNoobotPlugin || registerNoobotPlugin;

  return function createHarnessPlugin(userOptions = {}) {
    const options = normalizeOptionsFn(userOptions);
    return {
      name: PLUGIN_NAME,
      version: PLUGIN_VERSION,
      options,
      register(api = {}) {
        return registerNoobotPluginFn(api, options);
      },
    };
  };
}

export const createHarnessPlugin = createHarnessPluginFactory();
