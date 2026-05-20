/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export { PLUGIN_NAME, PLUGIN_VERSION, HARNESS_HOOK_POINTS } from "./constants.js";
export { createPluginRuntimeContext, createPluginRuntimeContextFactory } from "./plugin-runtime-context.js";
export { registerNoobotPlugin, createRegisterNoobotPlugin } from "./plugin-registration.js";
export { createHarnessPlugin, createHarnessPluginFactory } from "./plugin-factory.js";
export { registerHarnessHooks, createRegisterHarnessHooks } from "./register-hooks.js";
export { applyTakeover, registerTakeover } from "./takeover/dispatcher.js";

export { createHarnessPlugin as default } from "./plugin-factory.js";
