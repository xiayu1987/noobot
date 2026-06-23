/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import "dotenv/config";
import express from "express";
import { createGlobalConfigBuilder } from "#agent/config";
import {
  getConnectorChannelStore,
  initConnectorChannelStore,
  getConnectorHistoryStore,
  initConnectorHistoryStore,
} from "#agent/connectors";
import { createAppDependencies } from "./bootstrap/create-app-dependencies.js";
import { registerGlobalMiddlewares } from "./bootstrap/register-global-middlewares.js";
import { registerHttpModules } from "./bootstrap/register-http-modules.js";
import { startHttpServer } from "./bootstrap/start-http-server.js";
import { createServiceGlobalConfigSource } from "./services/global-config-source.js";
import { buildWorkspaceTree } from "./services/workspace-tree-service.js";

const app = express();

const globalConfigSource = createServiceGlobalConfigSource();
const globalConfigBuilder = createGlobalConfigBuilder({
  source: globalConfigSource,
  sourceName: globalConfigSource.name,
});
const appDependencies = await createAppDependencies({
  globalConfigBuilder,
  initConnectorHistoryStore,
  getConnectorChannelStore,
  getConnectorHistoryStore,
  buildWorkspaceTree,
});
const {
  resolveRequestLocale,
  translateText,
  normalizeRunConfig,
  resolveAuthByApiKey,
  isForbiddenUserScope,
  normalizeLocale,
  defaultLocale,
  workspaceRootPath,
  getBot,
  buildHttpModuleDependencies,
  openVSCodeService,
} = appDependencies;

registerGlobalMiddlewares(app, {
  resolveRequestLocale,
  defaultLocale,
});

initConnectorChannelStore();
initConnectorHistoryStore({ workspaceRoot: workspaceRootPath() });

await registerHttpModules(app, buildHttpModuleDependencies());

app.get("/health", (_, res) => res.json({ ok: true }));

openVSCodeService?.startLifecycleManager?.();

function stopManagedOpenVSCodeInstances() {
  openVSCodeService?.stopLifecycleManager?.({ stopInstances: true });
}

process.once("SIGINT", () => {
  stopManagedOpenVSCodeInstances();
  process.exit(0);
});

process.once("SIGTERM", () => {
  stopManagedOpenVSCodeInstances();
  process.exit(0);
});

startHttpServer({
  app,
  getBot,
  resolveRequestLocale,
  resolveAuthByApiKey,
  isForbiddenUserScope,
  normalizeRunConfig,
  normalizeLocale,
  defaultLocale,
  translateText,
  openVSCodeService,
});
