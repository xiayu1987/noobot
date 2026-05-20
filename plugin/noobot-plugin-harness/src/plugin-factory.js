/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { PLUGIN_NAME, PLUGIN_VERSION } from "./constants.js";
import { normalizeOptions } from "./options.js";
import { registerNoobotPlugin } from "./plugin-registration.js";

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
