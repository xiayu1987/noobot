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
  createRunConfigPluginPreparer,
  createSessionPluginRuntime,
} from "../bot-manage/session/session-plugin-runtime-adapter.js";
import {
  PLUGIN_RUNTIME_PROPERTY,
  PLUGIN_SLOT_KEY,
} from "./plugin-constants.js";

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

function resolvePluginKeyByCapability({ loadedPlugins = null, descriptor = {} } = {}) {
  const matched = resolveFirstLoadedNoobotPluginByCapability(
    loadedPlugins,
    descriptor.capability,
  );
  return String(matched?.manifest?.pluginKey || matched?.manifest?.id || "").trim();
}

function resolvePluginModelConfigKeysByCapability({ loadedPlugins = null, descriptor = {} } = {}) {
  const matched = resolveFirstLoadedNoobotPluginByCapability(
    loadedPlugins,
    descriptor.capability,
  );
  return [matched?.manifest?.pluginKey, matched?.manifest?.id];
}

const SESSION_PLUGIN_DESCRIPTORS = Object.freeze([
  Object.freeze({
    keyProperty: PLUGIN_RUNTIME_PROPERTY.AGENT_PLUGIN_KEY,
    selectorsProperty: PLUGIN_RUNTIME_PROPERTY.AGENT_PLUGIN_SELECTORS,
    modelConfigKeysProperty: "agentPluginModelConfigKeys",
    capability: PLUGIN_CAPABILITY.AGENT_REGISTER,
    fallbackKey: PLUGIN_SLOT_KEY.AGENT,
    resolveModelConfigKeys: resolvePluginModelConfigKeysByCapability,
  }),
  Object.freeze({
    keyProperty: PLUGIN_RUNTIME_PROPERTY.BOT_PLUGIN_KEY,
    selectorsProperty: PLUGIN_RUNTIME_PROPERTY.BOT_PLUGIN_SELECTORS,
    modelConfigKeysProperty: "botPluginModelConfigKeys",
    capability: PLUGIN_CAPABILITY.BOT_REGISTER,
    fallbackKey: PLUGIN_SLOT_KEY.BOT,
    resolveModelConfigKeys: resolvePluginModelConfigKeysByCapability,
  }),
]);

const defaultSessionPluginRuntime = createSessionPluginRuntime({
  loadedPlugins: loadedDynamicPlugins,
  descriptors: SESSION_PLUGIN_DESCRIPTORS,
  resolvePluginKey: resolvePluginKeyByCapability,
});

export function getDefaultSessionPluginRuntime() {
  return defaultSessionPluginRuntime;
}

export function getDefaultLoadedDynamicPlugins() {
  return loadedDynamicPlugins;
}

export function createDefaultRunConfigPluginPreparer(options = {}) {
  return createRunConfigPluginPreparer({
    ...options,
    loadedPlugins: loadedDynamicPlugins,
    pluginRuntime: defaultSessionPluginRuntime,
  });
}
