/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createAgentHookManager, AGENT_HOOK_POINTS } from "noobot-agent/hook";
import { createJsonRouteWrapper } from "../routes/route-wrapper.js";
import {
  buildNoobotPluginDiagnostics,
  getNoobotPluginRuntime,
  listLoadedNoobotPluginEntries,
  manifestSupportsCapability,
  PLUGIN_CAPABILITY,
  refreshNoobotPluginRuntime,
  resolveManifestRuntimeOptionsByCapability,
} from "@noobot/plugin-runtime";

const dynamicPluginRuntimeOptions = {
  requiredApiVersion: "1",
  runtimeSurface: "service",
};

const EMPTY_DYNAMIC_PLUGIN_RUNTIME = Object.freeze({
  pluginRootDir: "",
  requiredApiVersion: "1",
  discoveredCount: 0,
  loadedCount: 0,
  skippedCount: 0,
  skipped: [],
  registry: new Map(),
  errors: [],
  loadedAt: "",
});

const SERVICE_EVENT = Object.freeze({
  AFTER_SESSION_DELETE: "after_session_delete",
});

const SERVICE_ROUTE_CAPABILITY = PLUGIN_CAPABILITY.SERVICE_HTTP_ROUTES;

function resolveServiceEventCapability(eventName = "") {
  const normalized = String(eventName || "").trim().toLowerCase();
  return normalized ? `service.${normalized}` : "";
}

function resolveManifestRuntimeOptionsByServiceEvent(manifest = {}, eventName = "") {
  const serviceCapability = resolveServiceEventCapability(eventName);
  const runtimeOptions =
    manifest?.runtimeOptions &&
    typeof manifest.runtimeOptions === "object" &&
      !Array.isArray(manifest.runtimeOptions)
      ? manifest.runtimeOptions
      : {};
  const item = runtimeOptions[serviceCapability];
  return item && typeof item === "object" && !Array.isArray(item) ? { ...item } : {};
}

function supportsServiceEvent(manifest = {}, eventName = "") {
  const serviceCapability = resolveServiceEventCapability(eventName);
  return manifestSupportsCapability(manifest, serviceCapability);
}

export function createServicePluginHost({
  loadPluginRuntime = getNoobotPluginRuntime,
  pluginRootDir = "",
} = {}) {
  const runtimeOptions = {
    ...dynamicPluginRuntimeOptions,
    ...(String(pluginRootDir || "").trim()
      ? { pluginRootDir: String(pluginRootDir).trim() }
      : {}),
  };
  const loadedDynamicPluginsPromise = loadPluginRuntime(runtimeOptions).catch(
    () => EMPTY_DYNAMIC_PLUGIN_RUNTIME,
  );

  async function resolveLoadedPlugins({ refresh = false } = {}) {
    if (refresh) {
      return refreshNoobotPluginRuntime(runtimeOptions).catch(
        () => EMPTY_DYNAMIC_PLUGIN_RUNTIME,
      );
    }
    return loadedDynamicPluginsPromise;
  }

  async function registerAfterSessionDeleteHooks({
    hookManager = null,
    loadedPlugins = EMPTY_DYNAMIC_PLUGIN_RUNTIME,
    basePath = "",
  } = {}) {
    if (!hookManager || typeof hookManager?.on !== "function") return;
    const candidates = listLoadedNoobotPluginEntries(loadedPlugins).filter((item = {}) =>
      supportsServiceEvent(item?.manifest, SERVICE_EVENT.AFTER_SESSION_DELETE),
    );
    for (const candidate of candidates) {
      const registerPlugin =
        typeof candidate?.registerNoobotPlugin === "function"
          ? candidate.registerNoobotPlugin
          : null;
      if (typeof registerPlugin !== "function") continue;
      const options = resolveManifestRuntimeOptionsByServiceEvent(
        candidate?.manifest,
        SERVICE_EVENT.AFTER_SESSION_DELETE,
      );
      if (basePath && !options.basePath) {
        options.basePath = basePath;
      }
      registerPlugin({ hookManager }, options);
    }
  }


  async function registerServiceRoutes(app, context = {}) {
    if (!app || typeof app?.get !== "function") return [];
    const loadedPlugins = await resolveLoadedPlugins();
    const candidates = listLoadedNoobotPluginEntries(loadedPlugins).filter((item = {}) =>
      manifestSupportsCapability(item?.manifest, SERVICE_ROUTE_CAPABILITY),
    );
    const registered = [];
    for (const candidate of candidates) {
      const registerRoutes =
        typeof candidate?.moduleNamespace?.registerServiceRoutes === "function"
          ? candidate.moduleNamespace.registerServiceRoutes
          : typeof candidate?.moduleNamespace?.registerNoobotServiceRoutes === "function"
            ? candidate.moduleNamespace.registerNoobotServiceRoutes
            : null;
      if (typeof registerRoutes !== "function") continue;
      const options = resolveManifestRuntimeOptionsByCapability(
        candidate?.manifest,
        SERVICE_ROUTE_CAPABILITY,
      );
      const result = await registerRoutes(app, {
        ports: context?.ports,
        translateText: context?.translateText,
        plugin: {
          id: String(candidate?.pluginId || candidate?.manifest?.id || "").trim(),
          manifest: candidate?.manifest || {},
          pluginDir: String(candidate?.pluginDir || "").trim(),
        },
        createJsonRouteWrapper,
        jsonRoute: createJsonRouteWrapper({ translateText: context?.translateText }),
      }, options);
      registered.push({
        pluginId: String(candidate?.pluginId || candidate?.manifest?.id || "").trim(),
        result: result || null,
      });
    }
    return registered;
  }

  return {
    registerServiceRoutes,

    async getPluginDiagnostics({ refresh = false } = {}) {
      const loadedPlugins = await resolveLoadedPlugins({ refresh });
      return buildNoobotPluginDiagnostics(loadedPlugins);
    },

    async emitAfterSessionDelete({
      bot = null,
      userId = "",
      sessionId = "",
      deletedSessionIds = [],
    } = {}) {
      const basePath =
        bot && typeof bot.getWorkspacePath === "function"
          ? String(bot.getWorkspacePath(userId) || "").trim()
          : "";
      if (!basePath) return;
      const loadedPlugins = await resolveLoadedPlugins();
      const hookManager = createAgentHookManager();
      await registerAfterSessionDeleteHooks({
        hookManager,
        loadedPlugins,
        basePath,
      });
      await hookManager.emit(AGENT_HOOK_POINTS.AFTER_SESSION_DELETE, {
        userId: String(userId || "").trim(),
        sessionId: String(sessionId || "").trim(),
        deletedSessionIds: Array.isArray(deletedSessionIds)
          ? deletedSessionIds.map((id) => String(id || "").trim()).filter(Boolean)
          : [],
        basePath,
        executionScope: "primary",
      });
    },
  };
}
