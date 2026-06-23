/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createAgentHookManager, AGENT_HOOK_POINTS } from "../../agent/src/system-core/hook/index.js";
import { createJsonRouteWrapper } from "../routes/route-wrapper.js";
import {
  buildNoobotPluginDiagnostics,
  getNoobotPluginRuntime,
  listLoadedNoobotPluginEntries,
  refreshNoobotPluginRuntime,
} from "../../agent/src/system-core/plugin/plugin-loader.js";

const dynamicPluginRuntimeOptions = {
  requiredApiVersion: "1",
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

const SERVICE_ROUTE_CAPABILITY = "service.http_routes";


function supportsServiceRoutes(manifest = {}) {
  const capabilities = Array.isArray(manifest?.capabilities)
    ? manifest.capabilities.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (capabilities.includes(SERVICE_ROUTE_CAPABILITY)) return true;
  const runtimeOptions =
    manifest?.runtimeOptions &&
    typeof manifest.runtimeOptions === "object" &&
    !Array.isArray(manifest.runtimeOptions)
      ? manifest.runtimeOptions
      : {};
  return Boolean(runtimeOptions[SERVICE_ROUTE_CAPABILITY]);
}

function resolveManifestRuntimeOptionsByCapability(manifest = {}, capability = "") {
  const normalizedCapability = String(capability || "").trim();
  if (!normalizedCapability) return {};
  const runtimeOptions =
    manifest?.runtimeOptions &&
    typeof manifest.runtimeOptions === "object" &&
    !Array.isArray(manifest.runtimeOptions)
      ? manifest.runtimeOptions
      : {};
  const item = runtimeOptions[normalizedCapability];
  return item && typeof item === "object" && !Array.isArray(item) ? { ...item } : {};
}

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
  if (!serviceCapability) return false;
  const capabilities = Array.isArray(manifest?.capabilities)
    ? manifest.capabilities.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (capabilities.includes(serviceCapability)) return true;
  const runtimeOptions =
    manifest?.runtimeOptions &&
    typeof manifest.runtimeOptions === "object" &&
    !Array.isArray(manifest.runtimeOptions)
      ? manifest.runtimeOptions
      : {};
  return Boolean(runtimeOptions[serviceCapability]);
}

export function createServicePluginHost() {
  const loadedDynamicPluginsPromise = getNoobotPluginRuntime(dynamicPluginRuntimeOptions).catch(
    () => EMPTY_DYNAMIC_PLUGIN_RUNTIME,
  );

  async function resolveLoadedPlugins({ refresh = false } = {}) {
    if (refresh) {
      return refreshNoobotPluginRuntime(dynamicPluginRuntimeOptions).catch(
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
      supportsServiceRoutes(item?.manifest),
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
        ...context,
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
