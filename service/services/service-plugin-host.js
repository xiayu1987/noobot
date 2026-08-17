/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  collectSessionDeletionHookResult,
  createHookManager,
  HOOK_POINT,
} from "@noobot/hook-protocol";
import {
  PLUGIN_SURFACE,
  requireDeclaredPluginHook,
  requireDeclaredPluginHookEmission,
  requireDeclaredPluginRoute,
} from "@noobot/plugin-protocol";
import { createJsonRouteWrapper } from "../routes/route-wrapper.js";
import {
  activateLoadedNoobotPlugin,
  buildNoobotPluginDiagnostics,
  getNoobotPluginRuntime,
  listLoadedNoobotPluginEntries,
  refreshNoobotPluginRuntime,
} from "@noobot/plugin-runtime";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRoutedRuntimeEvent,
} from "@noobot/runtime-events";

function reportPluginEvent(record = {}) {
  void writeRoutedRuntimeEvent({
    scope: "startup",
    source: "service",
    channel: RUNTIME_EVENT_CHANNELS.DIRECT,
    category: RUNTIME_EVENT_CATEGORIES.STATE,
    level: record.event === "plugin.failed" ? "error" : "info",
    event: record.event,
    data: record,
  });
}

function scopeHandlerId(pluginId = "", handlerId = "") {
  const normalized = String(handlerId || "").trim();
  if (!normalized) throw new TypeError(`plugin ${pluginId} hook handler id is required`);
  return `${pluginId}:${normalized}`;
}

export function createServicePluginHost({
  loadPluginRuntime = getNoobotPluginRuntime,
  refreshPluginRuntime = refreshNoobotPluginRuntime,
  pluginRootDir = "",
} = {}) {
  const runtimeOptions = {
    surface: PLUGIN_SURFACE.SERVICE,
    ...(String(pluginRootDir || "").trim() ? { pluginRootDir: String(pluginRootDir).trim() } : {}),
  };
  let runtimePromise = null;
  let activationPromise = null;
  let hookManager = createHookManager();
  const activations = new Map();

  function load({ refresh = false } = {}) {
    if (refresh) {
      runtimePromise = refreshPluginRuntime(runtimeOptions);
      activationPromise = null;
      hookManager = createHookManager();
      activations.clear();
    }
    if (!runtimePromise) runtimePromise = loadPluginRuntime(runtimeOptions);
    return runtimePromise;
  }

  function createPluginHost({ entry, app, context, registeredRoutes, registeredEndpoints }) {
    const { manifest, pluginId } = entry;
    const jsonRoute = createJsonRouteWrapper({ translateText: context?.translateText });
    return Object.freeze({
      hooks: Object.freeze({
        register(point, handler, options = {}) {
          requireDeclaredPluginHook(manifest, PLUGIN_SURFACE.SERVICE, point);
          return hookManager.on(point, handler, {
            ...options,
            id: scopeHandlerId(pluginId, options?.id),
          });
        },
        emit(point, payload, options) {
          requireDeclaredPluginHookEmission(manifest, PLUGIN_SURFACE.SERVICE, point);
          return hookManager.emit(point, payload, options);
        },
      }),
      routes: Object.freeze({
        bind(routeId, handler) {
          if (!app) throw new Error(`plugin ${pluginId} cannot bind routes before service startup`);
          if (typeof handler !== "function") throw new TypeError(`plugin route handler is required: ${routeId}`);
          const route = requireDeclaredPluginRoute(manifest, routeId);
          const routeKey = `${pluginId}:${route.id}`;
          if (registeredRoutes.has(routeKey)) throw new Error(`duplicate plugin route binding: ${routeKey}`);
          const register = app[String(route.method || "").toLowerCase()];
          if (typeof register !== "function") throw new Error(`service does not support route method ${route.method}`);
          for (const routePath of route.paths) {
            const endpoint = `${route.method} ${routePath}`;
            if (registeredEndpoints.has(endpoint)) throw new Error(`duplicate plugin route endpoint: ${endpoint}`);
            registeredEndpoints.add(endpoint);
            register.call(app, routePath, jsonRoute(handler));
          }
          registeredRoutes.add(routeKey);
          return Object.freeze({ id: route.id, method: route.method, paths: [...route.paths] });
        },
      }),
      ports: context?.ports || Object.freeze({}),
    });
  }

  async function activatePlugins({ app = null, context = {} } = {}) {
    if (activationPromise) return activationPromise;
    activationPromise = (async () => {
      const runtime = await load();
      for (const record of runtime.lifecycleEvents || []) reportPluginEvent(record);
      if (runtime.errors?.length) {
        throw new Error(`service plugin runtime failed: ${runtime.errors.map((item) => `${item.pluginId}: ${item.message}`).join("; ")}`);
      }
      const registeredRoutes = new Set();
      const registeredEndpoints = new Set();
      for (const entry of listLoadedNoobotPluginEntries(runtime)) {
        const activation = await activateLoadedNoobotPlugin(entry, {
          host: createPluginHost({ entry, app, context, registeredRoutes, registeredEndpoints }),
          config: entry.manifest.configuration?.defaults || {},
        });
        activations.set(entry.pluginId, activation);
        reportPluginEvent({
          event: "plugin.activated",
          pluginId: entry.pluginId,
          pluginVersion: entry.manifest.version,
          protocolVersion: entry.manifest.protocolVersion,
          surface: PLUGIN_SURFACE.SERVICE,
        });
      }
      const declaredRoutes = listLoadedNoobotPluginEntries(runtime)
        .flatMap((entry) => entry.manifest.contributes.service?.routes || []);
      if (app && registeredRoutes.size !== declaredRoutes.length) {
        throw new Error(`service plugins bound ${registeredRoutes.size} of ${declaredRoutes.length} declared routes`);
      }
      for (const entry of listLoadedNoobotPluginEntries(runtime)) {
        reportPluginEvent({
          event: "plugin.contribution_committed",
          pluginId: entry.pluginId,
          pluginVersion: entry.manifest.version,
          protocolVersion: entry.manifest.protocolVersion,
          surface: PLUGIN_SURFACE.SERVICE,
        });
      }
      return runtime;
    })();
    return activationPromise;
  }

  return Object.freeze({
    async registerServiceRoutes(app, context = {}) {
      const runtime = await activatePlugins({ app, context });
      return listLoadedNoobotPluginEntries(runtime).map((entry) => ({
        pluginId: entry.pluginId,
        activation: activations.get(entry.pluginId),
      }));
    },

    async getPluginDiagnostics({ refresh = false } = {}) {
      const runtime = refresh ? await load({ refresh: true }) : await load();
      return buildNoobotPluginDiagnostics(runtime);
    },

    async emitAfterSessionDelete({
      bot = null,
      userId = "",
      sessionId = "",
      deletedSessionIds = [],
      remainingSessionIds = [],
    } = {}) {
      if (!activationPromise) throw new Error("service plugins must be activated during HTTP startup");
      await activationPromise;
      const basePath = bot && typeof bot.getWorkspacePath === "function"
        ? String(bot.getWorkspacePath(userId) || "").trim()
        : "";
      if (!basePath) return collectSessionDeletionHookResult();
      const hookResult = await hookManager.emit(HOOK_POINT.SERVICE.AFTER_SESSION_DELETE, {
        userId: String(userId || "").trim(),
        sessionId: String(sessionId || "").trim(),
        deletedSessionIds: Array.isArray(deletedSessionIds)
          ? deletedSessionIds.map((id) => String(id || "").trim()).filter(Boolean)
          : [],
        remainingSessionIds: Array.isArray(remainingSessionIds)
          ? remainingSessionIds.map((id) => String(id || "").trim()).filter(Boolean)
          : [],
        basePath,
        executionScope: "primary",
      });
      return collectSessionDeletionHookResult(hookResult);
    },

    async dispose() {
      for (const [pluginId, activation] of activations) {
        await activation.dispose();
        reportPluginEvent({ event: "plugin.deactivated", pluginId, surface: PLUGIN_SURFACE.SERVICE });
      }
      activations.clear();
    },
  });
}
