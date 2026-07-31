/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { externalFrontendPluginEntries } from "./generated/external-entries.js";
import {
  listExtensionContributions,
  replacePluginExtensions,
} from "../extensions/extension-registry.js";
import { EXTENSION_POINTS } from "../extensions/extension-point-ids.js";
import { createScopedAuthenticatedHttpService } from "../infrastructure/http/authenticatedHttpService.js";
import { PLUGIN_CAPABILITY } from "@noobot/plugin-runtime/contracts";
import { logWorkflowDiagnostics } from "../modules/debug/loggers/workflowDiagnosticsLogger.js";

const REQUIRED_FRONTEND_PLUGIN_API_VERSION = "1";
function normalizeApiVersion(input = "") {
  return String(input || "").trim() || REQUIRED_FRONTEND_PLUGIN_API_VERSION;
}

export async function registerExternalFrontendPlugins() {
  for (const item of externalFrontendPluginEntries) {
    const pluginId = String(item?.pluginId || "").trim();
    const pluginName = String(item?.name || pluginId).trim();
    const apiVersion = normalizeApiVersion(item?.apiVersion);
    if (apiVersion !== REQUIRED_FRONTEND_PLUGIN_API_VERSION) {
      console.warn(
        `[frontend-plugin] skip ${pluginName}: unsupported apiVersion ${apiVersion}`,
      );
      continue;
    }
    let pluginModule = null;
    try {
      pluginModule = typeof item?.loadModule === "function" ? await item.loadModule() : item?.module;
    } catch (error) {
      console.warn(
        `[frontend-plugin] failed to load ${pluginName}: ${String(error?.message || error)}`,
      );
      continue;
    }
    const registerFn =
      typeof pluginModule?.registerFrontendPlugin === "function"
        ? pluginModule.registerFrontendPlugin
        : null;
    if (typeof registerFn !== "function") {
      console.warn(
        `[frontend-plugin] skip ${pluginName}: registerFrontendPlugin export not found`,
      );
      continue;
    }
    try {
      const capabilities = new Set(
        (Array.isArray(item?.capabilities) ? item.capabilities : [])
          .map((capability) => String(capability || "").trim())
          .filter(Boolean),
      );
      const stagedContributions = [];
      registerFn({
        contributeExtension(point, contribution = {}) {
          if (
            point === EXTENSION_POINTS.RUNTIME_STREAM_ROUTE &&
            !capabilities.has(PLUGIN_CAPABILITY.FRONTEND_RUNTIME_PROJECTION)
          ) {
            throw new Error(
              `${PLUGIN_CAPABILITY.FRONTEND_RUNTIME_PROJECTION} capability is required for ${point}`,
            );
          }
          stagedContributions.push({ point, contribution });
          return true;
        },
        extensionPoints: EXTENSION_POINTS,
        services: Object.freeze({
          authenticatedRequest: createScopedAuthenticatedHttpService({
            routePatterns: item?.authenticatedRoutePatterns,
          }),
        }),
        pluginMeta: {
          pluginId,
          pluginKey: String(item?.pluginKey || "").trim(),
          name: pluginName,
          version: String(item?.version || "").trim(),
          apiVersion,
          capabilities: Object.freeze([...capabilities]),
        },
        logger: console,
      });
      const stagedRuntimeContributions = stagedContributions.filter(
        ({ point }) => point === EXTENSION_POINTS.RUNTIME_STREAM_ROUTE,
      );
      if (
        capabilities.has(PLUGIN_CAPABILITY.FRONTEND_RUNTIME_PROJECTION) &&
        stagedRuntimeContributions.length === 0
      ) {
        throw new Error(`${PLUGIN_CAPABILITY.FRONTEND_RUNTIME_PROJECTION} declared without runtime projector`);
      }
      const committed = replacePluginExtensions(pluginId, stagedContributions);
      const runtimeContributions = listExtensionContributions(EXTENSION_POINTS.RUNTIME_STREAM_ROUTE)
        .filter((entry) => entry.pluginId === pluginId);
      logWorkflowDiagnostics("frontend.pluginRuntime.pluginRegistered", {
        pluginId,
        capabilities: [...capabilities],
        contributionIds: committed.map((entry) => entry.id),
        runtimeContributionIds: runtimeContributions.map((entry) => entry.id),
      });
      console.info(
        `[frontend-plugin] registered ${pluginName}: ${committed.length} contributions` +
        `${runtimeContributions.length ? `, runtime=${runtimeContributions.map((entry) => entry.id).join(",")}` : ""}`,
      );
    } catch (error) {
      console.warn(
        `[frontend-plugin] failed to load ${pluginName}: ${String(error?.message || error)}`,
      );
    }
  }
}
