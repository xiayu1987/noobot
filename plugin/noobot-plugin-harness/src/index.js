/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export { PLUGIN_NAME, PLUGIN_VERSION } from "./core/constants.js";
export { createPluginRuntimeContext, createPluginRuntimeContextFactory } from "./core/context.js";
export { registerHarnessCore, createHarnessRegistration } from "./core/plugin.js";
export { createHarnessCore, createHarnessCoreFactory } from "./core/plugin.js";
export { registerHarnessHooks, createRegisterHarnessHooks } from "./core/hooks.js";
export { resolveHarnessDenyToolNames } from "./core/options.js";
export { applyTakeover, registerTakeover } from "./takeover/dispatcher.js";

export { createHarnessCore as default } from "./core/plugin.js";
