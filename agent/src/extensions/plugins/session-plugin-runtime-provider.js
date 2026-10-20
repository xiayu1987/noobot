/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { PLUGIN_LIFECYCLE_EVENT, PLUGIN_SURFACE } from "@noobot/plugin-protocol";
import { getNoobotPluginRuntime } from "@noobot/plugin-runtime";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRuntimeEvent,
} from "@noobot/runtime-events";
import { text } from "@noobot/shared/value";

const reportedRuntimes = new WeakSet();

function reportRuntimeLifecycle(runtime) {
  if (!runtime || reportedRuntimes.has(runtime)) return;
  reportedRuntimes.add(runtime);
  for (const record of runtime.lifecycleEvents || []) {
    void writeRuntimeEvent({
      scope: "startup",
      source: "agent",
      channel: RUNTIME_EVENT_CHANNELS.DIRECT,
      category: RUNTIME_EVENT_CATEGORIES.STATE,
      level: record.event === PLUGIN_LIFECYCLE_EVENT.FAILED ? "error" : "info",
      event: record.event,
      data: record,
    });
  }
}

function runtimeDescriptor(loadedPlugins) {
  return Object.freeze({
    pluginIds: Object.freeze(Array.from(loadedPlugins.registry.keys())),
    surface: PLUGIN_SURFACE.AGENT,
  });
}

export async function createSessionPluginRuntimeBundle({ pluginRootDir = "" } = {}) {
  const loadedPlugins = await getNoobotPluginRuntime({
    surface: PLUGIN_SURFACE.AGENT,
    ...(text(pluginRootDir) ? { pluginRootDir: String(pluginRootDir).trim() } : {}),
  });
  if (loadedPlugins.errors.length) {
    throw new Error(
      `agent plugin runtime failed: ${loadedPlugins.errors.map((item) => `${item.pluginId}: ${item.message}`).join("; ")}`,
    );
  }
  reportRuntimeLifecycle(loadedPlugins);
  return { loadedPlugins, pluginRuntime: runtimeDescriptor(loadedPlugins) };
}
