/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { externalFrontendPluginEntries } from "./generated/external-entries.js";
import {
  createExtensionRegistryGeneration,
  listExtensionContributions,
  publishExtensionRegistryGeneration,
} from "../extensions/extension-registry.js";
import {
  EXTENSION_POINTS,
  PLUGIN_HOST_PORT,
  requireDeclaredFrontendContribution,
} from "@noobot/plugin-protocol";
import {
  createContributionTransaction,
  createPluginActivationScope,
  createPluginHostFacade,
} from "@noobot/plugin-runtime/core";
import { createScopedAuthenticatedHttpService } from "../infrastructure/http/authenticatedHttpService.js";
import { logWorkflowDiagnostics } from "../modules/debug/loggers/workflowDiagnosticsLogger.js";

let activeScope = null;
let activeGeneration = null;

function loadedFrontendEntries() {
  return externalFrontendPluginEntries.map((item) => {
    const pluginId = String(item?.pluginId || "").trim();
    return {
      pluginId,
      manifest: item.manifest,
      surface: "frontend",
      item,
      async activate(host, config) {
        const pluginModule = typeof item?.loadModule === "function" ? await item.loadModule() : item?.module;
        if (typeof pluginModule?.activate !== "function") {
          throw new Error(`[frontend-plugin] ${String(item?.name || pluginId).trim()} must export activate`);
        }
        return pluginModule.activate(host, config);
      },
    };
  });
}

export async function registerExternalFrontendPlugins() {
  const generation = createExtensionRegistryGeneration();
  const scope = await createPluginActivationScope({
    entries: loadedFrontendEntries(),
    configFactory: (entry) => entry.manifest.configuration?.defaults || {},
    transactionFactory: (entry) => {
      return createContributionTransaction({
        commit: (staged) => generation.replacePlugin(entry.pluginId, staged),
        rollback: () => generation.removePlugin(entry.pluginId),
      });
    },
    hostFactory: (entry, transaction) => createPluginHostFacade({
      entry,
      publicContext: {
        extensionPoints: EXTENSION_POINTS,
        pluginMeta: Object.freeze({
          pluginId: entry.pluginId,
          name: String(entry.item?.name || entry.pluginId).trim(),
          version: String(entry.item?.version || "").trim(),
          protocolVersion: entry.manifest.protocolVersion,
        }),
        logger: console,
      },
      capabilityAdapters: {
        [PLUGIN_HOST_PORT.FRONTEND_CONTRIBUTE]: {
          path: ["contributeExtension"],
          value(point, contribution = {}) {
            requireDeclaredFrontendContribution(entry.manifest, contribution?.id, point);
            const key = `${point}#${contribution.id}`;
            if (transaction.receipt().some((item) => `${item.point}#${item.contribution.id}` === key)) {
              throw new Error(`plugin ${entry.pluginId} registered duplicate frontend contribution ${key}`);
            }
            transaction.stage({
              type: "extension",
              contributionId: contribution.id,
              point,
              contribution,
            });
            return true;
          },
        },
        [PLUGIN_HOST_PORT.AUTHENTICATED_REQUEST]: {
          path: ["services", "authenticatedRequest"],
          value: createScopedAuthenticatedHttpService({ routePatterns: entry.manifest.requires.authenticatedRoutes }),
        },
      },
    }),
  });
  publishExtensionRegistryGeneration(generation);
  const previousScope = activeScope;
  activeScope = scope;
  activeGeneration = generation;
  if (previousScope) await previousScope.dispose();
  for (const entry of scope.entries) {
    const committed = listExtensionContributions().filter((item) => item.pluginId === entry.pluginId);
    const runtimeContributions = listExtensionContributions(EXTENSION_POINTS.RUNTIME_STREAM_ROUTE).filter((item) => item.pluginId === entry.pluginId);
    logWorkflowDiagnostics("frontend.pluginRuntime.pluginRegistered", {
      pluginId: entry.pluginId,
      protocolVersion: entry.manifest.protocolVersion,
      contributionIds: committed.map((item) => item.id),
      runtimeContributionIds: runtimeContributions.map((item) => item.id),
    });
    console.info(`[frontend-plugin] registered ${entry.item?.name || entry.pluginId}: ${committed.length} contributions`);
  }
  return scope;
}

export async function disposeExternalFrontendPlugins() {
  const scope = activeScope;
  activeScope = null;
  if (activeGeneration) {
    const emptyGeneration = activeGeneration.createGeneration();
    for (const entry of scope?.entries || []) emptyGeneration.removePlugin(entry.pluginId);
    publishExtensionRegistryGeneration(emptyGeneration);
    activeGeneration = emptyGeneration;
  }
  if (scope) await scope.dispose();
}
