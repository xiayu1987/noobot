/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  getNoobotPluginRuntime,
  resolveFirstLoadedNoobotPluginByCapability,
  buildNoobotPluginDiagnostics,
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
import fs from "node:fs";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRoutedRuntimeEvent,
} from "@noobot/runtime-events";

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

function isPluginDebugEnabled() {
  const value = String(process.env.NOOBOT_PLUGIN_DEBUG || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function debugSessionPluginRuntime(message = "", details = {}) {
  if (!isPluginDebugEnabled()) return;
  void writeRoutedRuntimeEvent({
    source: "agent",
    channel: RUNTIME_EVENT_CHANNELS.DIRECT,
    category: RUNTIME_EVENT_CATEGORIES.SYSTEM,
    level: "debug",
    event: "agent.plugin.sessionRuntime.debug",
    data: {
      message: String(message || ""),
      detailKeys: details && typeof details === "object" ? Object.keys(details).slice(0, 20) : [],
    },
  });
}

function logPluginStartupCheck({ loadedPlugins = null, pluginRuntime = null } = {}) {
  const diagnostics = buildNoobotPluginDiagnostics(loadedPlugins);
  const agentSelectors = Array.from(
    pluginRuntime?.[PLUGIN_RUNTIME_PROPERTY.AGENT_PLUGIN_SELECTORS] || [],
  );
  const loaded = Array.isArray(diagnostics?.loaded) ? diagnostics.loaded : [];
  const agentPluginKey = String(
    pluginRuntime?.[PLUGIN_RUNTIME_PROPERTY.AGENT_PLUGIN_KEY] || "",
  ).trim();
  const agentPluginLoaded = agentPluginKey
    ? loaded.some((item = {}) => {
    const id = String(item.id || "").trim();
    const pluginKey = String(item.pluginKey || "").trim();
        return id === agentPluginKey || pluginKey === agentPluginKey;
      })
    : false;
  void writeRoutedRuntimeEvent({
    scope: "startup",
    source: "agent",
    channel: RUNTIME_EVENT_CHANNELS.DIRECT,
    category: RUNTIME_EVENT_CATEGORIES.STATE,
    level: "warn",
    event: "agent.plugin.startupCheck",
    data: {
    pluginRootDirLength: String(diagnostics.pluginRootDir || "").length,
    pluginRootDirExists: diagnostics.pluginRootDir ? fs.existsSync(diagnostics.pluginRootDir) : false,
    discoveredCount: diagnostics.discoveredCount,
    loadedCount: diagnostics.loadedCount,
    skippedCount: diagnostics.skippedCount,
    loadedCountReported: loaded.length,
    errorCount: Array.isArray(diagnostics.errors) ? diagnostics.errors.length : 0,
    agentPluginKeyLength: agentPluginKey.length,
    agentPluginSelectorCount: agentSelectors.length,
    agentPluginLoaded,
    agentPluginSelectable: agentPluginKey ? agentSelectors.includes(agentPluginKey) : false,
    },
  });
}

export async function createSessionPluginRuntimeBundle({
  pluginRootDir = "",
  requiredApiVersion = "1",
} = {}) {
  const loadedPlugins = await getNoobotPluginRuntime({
    pluginRootDir,
    requiredApiVersion,
  }).catch(() => ({
    pluginRootDir: String(pluginRootDir || ""),
    requiredApiVersion,
    discoveredCount: 0,
    loadedCount: 0,
    registry: new Map(),
    errors: [],
  }));
  const pluginRuntime = createSessionPluginRuntime({
    loadedPlugins,
    descriptors: SESSION_PLUGIN_DESCRIPTORS,
    resolvePluginKey: resolvePluginKeyByCapability,
  });
  debugSessionPluginRuntime("runtime bundle initialized", {
    diagnostics: buildNoobotPluginDiagnostics(loadedPlugins),
    runtime: {
      agentPluginKey: pluginRuntime?.[PLUGIN_RUNTIME_PROPERTY.AGENT_PLUGIN_KEY],
      agentPluginSelectors: Array.from(pluginRuntime?.[PLUGIN_RUNTIME_PROPERTY.AGENT_PLUGIN_SELECTORS] || []),
      botPluginKey: pluginRuntime?.[PLUGIN_RUNTIME_PROPERTY.BOT_PLUGIN_KEY],
      botPluginSelectors: Array.from(pluginRuntime?.[PLUGIN_RUNTIME_PROPERTY.BOT_PLUGIN_SELECTORS] || []),
    },
  });
  logPluginStartupCheck({ loadedPlugins, pluginRuntime });
  return { loadedPlugins, pluginRuntime };
}

export function createRunConfigPluginPreparerFromRuntimeBundle({
  loadedPlugins = loadedDynamicPlugins,
  pluginRuntime = defaultSessionPluginRuntime,
  ...options
} = {}) {
  return createRunConfigPluginPreparer({
    ...options,
    loadedPlugins,
    pluginRuntime,
  });
}

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

debugSessionPluginRuntime("default runtime initialized", {
  diagnostics: buildNoobotPluginDiagnostics(loadedDynamicPlugins),
  runtime: {
    agentPluginKey: defaultSessionPluginRuntime?.[PLUGIN_RUNTIME_PROPERTY.AGENT_PLUGIN_KEY],
    agentPluginSelectors: Array.from(
      defaultSessionPluginRuntime?.[PLUGIN_RUNTIME_PROPERTY.AGENT_PLUGIN_SELECTORS] || [],
    ),
    botPluginKey: defaultSessionPluginRuntime?.[PLUGIN_RUNTIME_PROPERTY.BOT_PLUGIN_KEY],
    botPluginSelectors: Array.from(
      defaultSessionPluginRuntime?.[PLUGIN_RUNTIME_PROPERTY.BOT_PLUGIN_SELECTORS] || [],
    ),
  },
});

export function getDefaultSessionPluginRuntime() {
  return defaultSessionPluginRuntime;
}

export function getDefaultLoadedDynamicPlugins() {
  return loadedDynamicPlugins;
}

export function createDefaultRunConfigPluginPreparer(options = {}) {
  return createRunConfigPluginPreparerFromRuntimeBundle({
    ...options,
    loadedPlugins: loadedDynamicPlugins,
    pluginRuntime: defaultSessionPluginRuntime,
  });
}
