/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createGlobalConfigBuilder } from "#agent/config";
import { ConnectorRuntime } from "@noobot/connector-runtime";
import { registerBuiltinConnectorInstances } from "@noobot/connector-instances";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRoutedRuntimeEvent,
} from "@noobot/runtime-events";
import { createAppDependencies } from "./create-app-dependencies.js";
import { createServiceGlobalConfigSource } from "../services/global-config-source.js";
import { ConnectorSecretVault } from "../security/connector-secret-vault.js";
import {
  applyStartupRuntimeEnv,
  loadStartupContext,
  safeStartupContextForLog,
} from "../services/startup-context-service.js";
import { buildWorkspaceTree } from "../services/workspace-tree-service.js";

function createConnectorRuntime({ getBot, workspaceRootPath, connectorSecretVault }) {
  const connectorRuntime = new ConnectorRuntime({
    repository: {
      list: (userId) => getBot().session.listConnectorInstances({ userId }),
      get: (payload) => getBot().session.getConnectorInstance(payload),
      create: (payload) => getBot().session.createConnectorInstance(payload),
      update: (payload) => getBot().session.updateConnectorInstance(payload),
      delete: (payload) => getBot().session.deleteConnectorInstance(payload),
      readLegacy: (userId) => getBot().session.readLegacyConnectorInstances({ userId }),
      migrateLegacy: (payload) => getBot().session.migrateLegacyConnectorInstances(payload),
    },
    secretStore: connectorSecretVault,
    workspaceRoot: workspaceRootPath(),
    resolveUserWorkspacePath: (userId) => getBot().getWorkspacePath(userId),
  });
  connectorSecretVault.setWorkspaceRoot(workspaceRootPath());
  registerBuiltinConnectorInstances(connectorRuntime);
  return connectorRuntime;
}

export async function createHeadlessRuntime({
  argv = process.argv,
  cwd = process.cwd(),
  startupSource = "service",
} = {}) {
  const startupContext = await loadStartupContext({ argv, cwd });
  applyStartupRuntimeEnv(startupContext);
  void writeRoutedRuntimeEvent({
    scope: "startup",
    source: startupSource,
    channel: RUNTIME_EVENT_CHANNELS.STARTUP,
    category: RUNTIME_EVENT_CATEGORIES.CONFIG,
    level: "info",
    event: "service.startup.context.loaded",
    workspaceRoot: startupContext?.workspaceRoot,
    data: safeStartupContextForLog(startupContext),
  });

  const globalConfigSource = createServiceGlobalConfigSource({ cwd });
  const globalConfigBuilder = createGlobalConfigBuilder({
    source: globalConfigSource,
    sourceName: globalConfigSource.name,
  });
  let connectorRuntime = null;
  const connectorSecretVault = new ConnectorSecretVault();
  const connectorAccessPort = Object.freeze({
    access: (payload) => connectorRuntime.access(payload),
    listUserConnectors: (userId) => connectorRuntime.listUserConnectors(userId),
  });
  const appDependencies = await createAppDependencies({
    startupContext,
    globalConfigBuilder,
    buildWorkspaceTree,
    connectorAccessPort,
  });
  connectorRuntime = createConnectorRuntime({
    getBot: appDependencies.getBot,
    workspaceRootPath: appDependencies.workspaceRootPath,
    connectorSecretVault,
  });

  async function releaseConnectors() {
    for (const userId of await appDependencies.readSessionUserIds()) {
      await connectorRuntime.releaseUser(userId);
    }
  }

  return {
    startupContext,
    appDependencies,
    connectorRuntime,
    connectorAccessPort,
    releaseConnectors,
  };
}
