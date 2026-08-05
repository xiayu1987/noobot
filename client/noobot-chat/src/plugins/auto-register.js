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
import {
  EXTENSION_POINTS,
  requireDeclaredFrontendContribution,
  validatePluginActivationResult,
} from "@noobot/plugin-protocol";
import { createScopedAuthenticatedHttpService } from "../infrastructure/http/authenticatedHttpService.js";
import { logWorkflowDiagnostics } from "../modules/debug/loggers/workflowDiagnosticsLogger.js";

export async function registerExternalFrontendPlugins() {
  for (const item of externalFrontendPluginEntries) {
    const pluginId = String(item?.pluginId || "").trim();
    const pluginName = String(item?.name || pluginId).trim();
    const manifest = item?.manifest;
    const pluginModule = typeof item?.loadModule === "function" ? await item.loadModule() : item?.module;
    const activate = typeof pluginModule?.activate === "function" ? pluginModule.activate : null;
    if (!activate) throw new Error(`[frontend-plugin] ${pluginName} must export activate`);
    const stagedContributions = [];
    const registeredContributionKeys = new Set();
      const activation = await activate({
        contributeExtension(point, contribution = {}) {
          requireDeclaredFrontendContribution(manifest, contribution?.id, point);
          const key = `${point}#${contribution.id}`;
          if (registeredContributionKeys.has(key)) {
            throw new Error(`plugin ${pluginId} registered duplicate frontend contribution ${key}`);
          }
          registeredContributionKeys.add(key);
          stagedContributions.push({ point, contribution });
          return true;
        },
        extensionPoints: EXTENSION_POINTS,
        services: Object.freeze({
          authenticatedRequest: createScopedAuthenticatedHttpService({
            routePatterns: manifest.requires.authenticatedRoutes,
          }),
        }),
        pluginMeta: {
          pluginId,
          name: pluginName,
          version: String(item?.version || "").trim(),
          protocolVersion: manifest.protocolVersion,
        },
        logger: console,
      });
      validatePluginActivationResult(activation, { pluginId, surface: "frontend" });
      const declared = manifest.contributes.frontend.extensions;
      if (registeredContributionKeys.size !== declared.length) {
        throw new Error(`plugin ${pluginId} registered ${stagedContributions.length} of ${declared.length} declared frontend contributions`);
      }
      const committed = replacePluginExtensions(pluginId, stagedContributions);
      const runtimeContributions = listExtensionContributions(EXTENSION_POINTS.RUNTIME_STREAM_ROUTE)
        .filter((entry) => entry.pluginId === pluginId);
      logWorkflowDiagnostics("frontend.pluginRuntime.pluginRegistered", {
        pluginId,
        protocolVersion: manifest.protocolVersion,
        contributionIds: committed.map((entry) => entry.id),
        runtimeContributionIds: runtimeContributions.map((entry) => entry.id),
      });
      console.info(
        `[frontend-plugin] registered ${pluginName}: ${committed.length} contributions` +
        `${runtimeContributions.length ? `, runtime=${runtimeContributions.map((entry) => entry.id).join(",")}` : ""}`,
      );
  }
}
