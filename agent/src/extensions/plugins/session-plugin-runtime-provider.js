/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { PLUGIN_SURFACE } from "@noobot/plugin-protocol";
import { buildNoobotPluginDiagnostics, getNoobotPluginRuntime } from "@noobot/plugin-runtime";
import { createRunConfigPluginPreparer } from "../../bot/session/session-plugin-runtime-adapter.js";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRoutedRuntimeEvent,
} from "@noobot/runtime-events";

const reportedRuntimes = new WeakSet();

function reportRuntimeLifecycle(runtime) {
  if (!runtime || reportedRuntimes.has(runtime)) return;
  reportedRuntimes.add(runtime);
  for (const record of runtime.lifecycleEvents || []) {
    void writeRoutedRuntimeEvent({
      scope: "startup",
      source: "agent",
      channel: RUNTIME_EVENT_CHANNELS.DIRECT,
      category: RUNTIME_EVENT_CATEGORIES.STATE,
      level: record.event === "plugin.failed" ? "error" : "info",
      event: record.event,
      data: record,
    });
  }
}

const loadedDynamicPlugins = await getNoobotPluginRuntime({ surface: PLUGIN_SURFACE.AGENT });
reportRuntimeLifecycle(loadedDynamicPlugins);

function runtimeDescriptor(loadedPlugins) {
  return Object.freeze({
    pluginIds: Object.freeze(Array.from(loadedPlugins.registry.keys())),
    surface: PLUGIN_SURFACE.AGENT,
  });
}

const defaultRuntimeDescriptor = runtimeDescriptor(loadedDynamicPlugins);

export async function createSessionPluginRuntimeBundle({ pluginRootDir = "" } = {}) {
  const loadedPlugins = await getNoobotPluginRuntime({
    surface: PLUGIN_SURFACE.AGENT,
    ...(String(pluginRootDir || "").trim() ? { pluginRootDir: String(pluginRootDir).trim() } : {}),
  });
  if (loadedPlugins.errors.length) {
    throw new Error(`agent plugin runtime failed: ${loadedPlugins.errors.map((item) => `${item.pluginId}: ${item.message}`).join("; ")}`);
  }
  reportRuntimeLifecycle(loadedPlugins);
  return { loadedPlugins, pluginRuntime: runtimeDescriptor(loadedPlugins) };
}

export function createRunConfigPluginPreparerFromRuntimeBundle({
  loadedPlugins = loadedDynamicPlugins,
  ...options
} = {}) {
  return createRunConfigPluginPreparer({ ...options, loadedPlugins });
}

export function getDefaultSessionPluginRuntime() {
  return defaultRuntimeDescriptor;
}

export function getDefaultLoadedDynamicPlugins() {
  return loadedDynamicPlugins;
}

export function createDefaultRunConfigPluginPreparer(options = {}) {
  return createRunConfigPluginPreparerFromRuntimeBundle({ ...options, loadedPlugins: loadedDynamicPlugins });
}

export function getDefaultPluginDiagnostics() {
  return buildNoobotPluginDiagnostics(loadedDynamicPlugins);
}
