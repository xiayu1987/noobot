/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { createPluginRuntimeContext, assertHookManager } from "./context.js";
import { normalizeOptions } from "./options.js";
import { PLUGIN_NAME, PLUGIN_VERSION } from "./constants.js";
import { registerWorkflowHooks } from "./hooks/index.js";

export function createWorkflowRegistration(deps = {}) {
  const createPluginRuntimeContextFn = deps.createPluginRuntimeContext || createPluginRuntimeContext;
  const assertHookManagerFn = deps.assertHookManager || assertHookManager;
  const registerWorkflowHooksFn = deps.registerWorkflowHooks || registerWorkflowHooks;

  return function registerWorkflowCore(api = {}, userOptions = {}) {
    const { options, hookManager } = createPluginRuntimeContextFn(api, userOptions);
    assertHookManagerFn(hookManager);
    if (!options.enabled || options.mode !== "on") {
      return { name: PLUGIN_NAME, version: PLUGIN_VERSION, disposers: [] };
    }
    if (
      api?.policy &&
      typeof api.policy.patch === "function" &&
      Array.isArray(options?.denyToolNames) &&
      options.denyToolNames.length
    ) {
      api.policy.patch({ denyToolNames: options.denyToolNames });
    }

    const disposers = registerWorkflowHooksFn({
      hookManager,
      options,
      plugin: { name: PLUGIN_NAME, version: PLUGIN_VERSION },
    });
    return { name: PLUGIN_NAME, version: PLUGIN_VERSION, disposers };
  };
}

export const registerWorkflowCore = createWorkflowRegistration();

export function createWorkflowCoreFactory(deps = {}) {
  const normalizeOptionsFn = deps.normalizeOptions || normalizeOptions;
  const registerWorkflowCoreFn = deps.registerWorkflowCore || registerWorkflowCore;

  return function createWorkflowCore(userOptions = {}) {
    const options = normalizeOptionsFn(userOptions);
    return {
      name: PLUGIN_NAME,
      version: PLUGIN_VERSION,
      options,
      register(api = {}) {
        return registerWorkflowCoreFn(api, options);
      },
    };
  };
}

export const createWorkflowCore = createWorkflowCoreFactory();
