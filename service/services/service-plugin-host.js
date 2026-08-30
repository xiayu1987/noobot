/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import express from "express";
import {
  collectSessionDeletionHookResult,
  createHookManager,
  HOOK_POINT,
} from "@noobot/hook-protocol";
import {
  PLUGIN_HOST_PORT,
  PLUGIN_LIFECYCLE_EVENT,
  PLUGIN_SURFACE,
  requireDeclaredPluginHook,
  requireDeclaredPluginHookEmission,
  requireDeclaredPluginRoute,
  serializePluginContributionIdentity,
} from "@noobot/plugin-protocol";
import { createJsonRouteWrapper } from "../routes/route-wrapper.js";
import {
  buildNoobotPluginDiagnostics,
  createContributionTransaction,
  createPluginActivationScope,
  createPluginHostFacade,
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
    level: record.event === PLUGIN_LIFECYCLE_EVENT.FAILED ? "error" : "info",
    event: record.event,
    data: record,
  });
}

function createRouteGeneration({ context = {} } = {}) {
  const router = express.Router();
  const jsonRoute = createJsonRouteWrapper({ translateText: context?.translateText });
  const endpointKeys = new Set();
  const routes = [];
  return Object.freeze({
    router,
    routes,
    stage(entry, routeId, handler) {
      if (typeof handler !== "function")
        throw new TypeError(`plugin route handler is required: ${routeId}`);
      const route = requireDeclaredPluginRoute(entry.manifest, routeId);
      for (const routePath of route.paths) {
        const endpoint = `${route.method} ${routePath}`;
        if (endpointKeys.has(endpoint))
          throw new Error(`duplicate plugin route endpoint: ${endpoint}`);
        endpointKeys.add(endpoint);
      }
      routes.push(Object.freeze({ entry, route, handler }));
      return Object.freeze({ id: route.id, method: route.method, paths: [...route.paths] });
    },
    commit() {
      for (const { route, handler } of routes) {
        const register = router[String(route.method || "").toLowerCase()];
        if (typeof register !== "function")
          throw new Error(`service does not support route method ${route.method}`);
        for (const routePath of route.paths) register.call(router, routePath, jsonRoute(handler));
      }
      return router;
    },
  });
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
  let activeScope = null;
  let activeRuntime = null;
  let activeHookManager = createHookManager();
  let activeRouter = express.Router();
  let mountedApp = null;
  let activationContext = null;
  let lifecycleGeneration = 0;
  let lifecycleState = "active";
  let disposalPromise = null;

  function assertLifecycleOwnership(generation) {
    if (lifecycleState !== "active" || generation !== lifecycleGeneration) {
      throw new Error("service plugin activation lost lifecycle ownership");
    }
  }

  function load({ refresh = false } = {}) {
    if (refresh) return refreshPluginRuntime(runtimeOptions);
    if (!runtimePromise) runtimePromise = loadPluginRuntime(runtimeOptions);
    return runtimePromise;
  }

  function mountDispatcher(app) {
    if (!app || typeof app.use !== "function")
      throw new TypeError("service plugin host requires an Express application");
    if (mountedApp && mountedApp !== app)
      throw new Error("service plugin host cannot mount on multiple applications");
    if (!mountedApp) {
      app.use((req, res, next) => activeRouter(req, res, next));
      mountedApp = app;
    }
  }

  async function activatePlugins({ app, context = {}, refresh = false } = {}) {
    if (lifecycleState !== "active") throw new Error("service plugin host is disposed");
    if (activationPromise && !refresh) return activationPromise;
    const operationGeneration = lifecycleGeneration;
    const previousOperation = activationPromise;
    const operation = (async () => {
      if (previousOperation) {
        try {
          await previousOperation;
        } catch {
          // A failed candidate never becomes active; the next queued refresh
          // still starts from the last committed generation.
        }
      }
      assertLifecycleOwnership(operationGeneration);
      mountDispatcher(app);
      const runtime = await load({ refresh });
      assertLifecycleOwnership(operationGeneration);
      for (const record of runtime.lifecycleEvents || []) reportPluginEvent(record);
      if (runtime.errors?.length) {
        throw new Error(
          `service plugin runtime failed: ${runtime.errors.map((item) => `${item.pluginId}: ${item.message}`).join("; ")}`,
        );
      }
      const candidateHooks = createHookManager();
      const generation = createRouteGeneration({ context });
      const scope = await createPluginActivationScope({
        entries: listLoadedNoobotPluginEntries(runtime),
        lifecycleSink: reportPluginEvent,
        configFactory: (entry) => entry.manifest.configuration?.defaults || {},
        transactionFactory: (entry) => {
          const routeStart = generation.routes.length;
          return createContributionTransaction({
            commit: () => undefined,
            rollback: (staged) => {
              for (const item of [...staged].reverse()) item.unregister?.();
              generation.routes.splice(routeStart);
            },
          });
        },
        hostFactory: (entry, transaction) =>
          createPluginHostFacade({
            entry,
            capabilityAdapters: {
              [PLUGIN_HOST_PORT.HOOKS_REGISTER]: {
                path: ["hooks", "register"],
                value(point, handler, options = {}) {
                  const declaration = requireDeclaredPluginHook(
                    entry.manifest,
                    PLUGIN_SURFACE.SERVICE,
                    point,
                    options?.id,
                  );
                  const unregister = candidateHooks.on(point, handler, {
                    ...options,
                    id: serializePluginContributionIdentity({
                      pluginId: entry.pluginId,
                      surface: entry.surface,
                      localId: declaration.id,
                    }),
                  });
                  transaction.stage({
                    type: "hook",
                    point: declaration.point,
                    registrationId: declaration.id,
                    unregister,
                  });
                  return unregister;
                },
              },
              [PLUGIN_HOST_PORT.HOOKS_EMIT]: {
                path: ["hooks", "emit"],
                value(point, payload, options) {
                  requireDeclaredPluginHookEmission(entry.manifest, PLUGIN_SURFACE.SERVICE, point);
                  return candidateHooks.emit(point, payload, options);
                },
              },
              [PLUGIN_HOST_PORT.ROUTES_BIND]: {
                path: ["routes", "bind"],
                value: (routeId, handler) => {
                  const result = generation.stage(entry, routeId, handler);
                  transaction.stage({ type: "route", routeId });
                  return result;
                },
              },
              [PLUGIN_HOST_PORT.SERVICE_SESSIONS_READ]: {
                path: ["ports", "sessions"],
                value: context?.ports?.sessions,
              },
              [PLUGIN_HOST_PORT.SERVICE_WORKSPACE_ASSETS]: {
                path: ["ports", "workspaceAssets"],
                value: context?.ports?.workspaceAssets?.forPlugin?.(entry.pluginId),
              },
              [PLUGIN_HOST_PORT.SERVICE_HTTP_STATUS]: {
                path: ["ports", "http"],
                value: context?.ports?.http,
              },
            },
          }),
      });
      let candidateRouter;
      try {
        candidateRouter = generation.commit();
        assertLifecycleOwnership(operationGeneration);
      } catch (error) {
        await scope.dispose({ cause: error });
      }
      const previousScope = activeScope;
      activeScope = scope;
      activeRuntime = runtime;
      activeHookManager = candidateHooks;
      activeRouter = candidateRouter;
      activationContext = { app, context };
      if (previousScope) await previousScope.dispose();
      return runtime;
    })();
    activationPromise = operation;
    try {
      return await operation;
    } finally {
      if (activationPromise === operation) activationPromise = null;
    }
  }

  return Object.freeze({
    async registerServiceRoutes(app, context = {}) {
      const runtime = await activatePlugins({ app, context });
      return listLoadedNoobotPluginEntries(runtime).map((entry) => ({
        pluginId: entry.pluginId,
        activation: activeScope.getActivation(entry.pluginId),
      }));
    },

    async refresh() {
      if (!activationContext) throw new Error("service plugins must be activated before refresh");
      return activatePlugins({ ...activationContext, refresh: true });
    },

    async getPluginDiagnostics({ refresh = false } = {}) {
      const runtime = refresh ? await load({ refresh: true }) : activeRuntime || (await load());
      return buildNoobotPluginDiagnostics(runtime);
    },

    async emitAfterSessionDelete({
      bot = null,
      userId = "",
      sessionId = "",
      deletedSessionIds = [],
      remainingSessionIds = [],
    } = {}) {
      if (!activeScope) throw new Error("service plugins must be activated during HTTP startup");
      const basePath =
        bot && typeof bot.getWorkspacePath === "function"
          ? String(bot.getWorkspacePath(userId) || "").trim()
          : "";
      if (!basePath) return collectSessionDeletionHookResult();
      const hookResult = await activeHookManager.emit(HOOK_POINT.SERVICE.AFTER_SESSION_DELETE, {
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
      if (disposalPromise) return disposalPromise;
      if (lifecycleState === "disposed") return;
      lifecycleState = "disposing";
      lifecycleGeneration += 1;
      const pendingOperation = activationPromise;
      disposalPromise = (async () => {
        if (pendingOperation) {
          try {
            await pendingOperation;
          } catch {
            /* Disposal owns final cleanup. */
          }
        }
        const scope = activeScope;
        activeScope = null;
        activeRuntime = null;
        activeHookManager = createHookManager();
        activeRouter = express.Router();
        try {
          if (scope) await scope.dispose();
        } finally {
          lifecycleState = "disposed";
        }
      })();
      return disposalPromise;
    },
  });
}
