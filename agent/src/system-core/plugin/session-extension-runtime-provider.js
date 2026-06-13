/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  getNoobotPluginRuntime,
  resolveFirstLoadedNoobotPluginByCapability,
} from "./plugin-loader.js";
import { PLUGIN_CAPABILITY } from "./capabilities.js";
import {
  createRunConfigExtensionPreparer,
  createSessionExtensionRuntime,
} from "../bot-manage/session/session-extension-runtime-adapter.js";

const loadedDynamicPlugins = await getNoobotPluginRuntime({
  requiredApiVersion: "1",
}).catch(() => ({
  pluginRootDir: "",
  requiredApiVersion: "1",
  discoveredCount: 0,
  loadedCount: 0,
  registry: new Map(),
  errors: [],
}));

function resolvePluginKeyByCapability({ loadedExtensions = null, descriptor = {} } = {}) {
  const matched = resolveFirstLoadedNoobotPluginByCapability(
    loadedExtensions,
    descriptor.capability,
  );
  return String(matched?.manifest?.pluginKey || matched?.manifest?.id || "").trim();
}

const SESSION_EXTENSION_DESCRIPTORS = Object.freeze([
  Object.freeze({
    keyProperty: "harnessPluginKey",
    selectorsProperty: "harnessPluginSelectors",
    capability: PLUGIN_CAPABILITY.AGENT_REGISTER,
    fallbackKey: "harness",
  }),
  Object.freeze({
    keyProperty: "workflowPluginKey",
    selectorsProperty: "workflowPluginSelectors",
    capability: PLUGIN_CAPABILITY.BOT_REGISTER,
    fallbackKey: "workflow",
  }),
]);

const defaultSessionExtensionRuntime = createSessionExtensionRuntime({
  loadedExtensions: loadedDynamicPlugins,
  descriptors: SESSION_EXTENSION_DESCRIPTORS,
  resolveExtensionKey: resolvePluginKeyByCapability,
});

export function getDefaultSessionExtensionRuntime() {
  return defaultSessionExtensionRuntime;
}

export function getDefaultLoadedDynamicPlugins() {
  return loadedDynamicPlugins;
}

export function createDefaultRunConfigExtensionPreparer(options = {}) {
  return createRunConfigExtensionPreparer({
    ...options,
    loadedExtensions: loadedDynamicPlugins,
    extensionRuntime: defaultSessionExtensionRuntime,
  });
}
