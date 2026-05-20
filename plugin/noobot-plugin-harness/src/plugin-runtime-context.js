/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createCapabilityRuntime } from "./capabilities/runtime.js";
import { normalizeOptions } from "./options.js";
import { resolveHookManager } from "./runtime-context.js";
import { PLUGIN_NAME } from "./constants.js";

export function normalizePlanningGuidance(options = {}) {
  if (options.planningGuidanceMode === "separate_model" && !options.capabilityModelInvoker) {
    options.planningGuidanceMode = "inject";
  }
}

export function createPluginRuntimeContextFactory(deps = {}) {
  const normalizeOptionsFn = deps.normalizeOptions || normalizeOptions;
  const resolveHookManagerFn = deps.resolveHookManager || resolveHookManager;
  const createCapabilityRuntimeFn = deps.createCapabilityRuntime || createCapabilityRuntime;

  return function createPluginRuntimeContext(api = {}, userOptions = {}) {
    const options = normalizeOptionsFn(userOptions, api);
    normalizePlanningGuidance(options);

    const hookManager = resolveHookManagerFn(api);
    const capabilityRuntime = createCapabilityRuntimeFn({
      profile: options.capabilityProfile,
      handlers: options.capabilityHandlers,
    });
    options.capabilityRuntime = capabilityRuntime;

    return { options, hookManager, capabilityRuntime };
  };
}

export function assertHookManager(hookManager) {
  if (!hookManager || typeof hookManager.on !== "function") {
    throw new Error(`${PLUGIN_NAME}: hookManager with .on(point, handler, options) is required`);
  }
}

export const createPluginRuntimeContext = createPluginRuntimeContextFactory();
