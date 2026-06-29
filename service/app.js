/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";
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
import {
  loadStartupContext,
  safeStartupContextForLog,
} from "./services/startup-context-service.js";
import { buildWorkspaceTree } from "./services/workspace-tree-service.js";

const app = express();
const startupContext = await loadStartupContext({ argv: process.argv, cwd: process.cwd() });
console.warn("[noobot:startup-context]", safeStartupContextForLog(startupContext));

const desktopFrontendRoot = String(
  startupContext?.paths?.frontendRoot || process.env.NOOBOT_DESKTOP_FRONTEND_ROOT || path.resolve(process.cwd(), "../frontend"),
).trim();
const shouldServeDesktopFrontend = process.env.NOOBOT_DESKTOP === "1"
  && fs.existsSync(path.join(desktopFrontendRoot, "index.html"));

const globalConfigSource = createServiceGlobalConfigSource();
const globalConfigBuilder = createGlobalConfigBuilder({
  source: globalConfigSource,
  sourceName: globalConfigSource.name,
});
const appDependencies = await createAppDependencies({
  startupContext,
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

if (shouldServeDesktopFrontend) {
  app.use("/api", (req, _res, next) => next());
}

initConnectorChannelStore();
initConnectorHistoryStore({ workspaceRoot: workspaceRootPath() });

await registerHttpModules(app, buildHttpModuleDependencies());

app.get("/health", (_, res) => res.json({ ok: true }));

if (shouldServeDesktopFrontend) {
  app.use(express.static(desktopFrontendRoot));
  app.get(/^\/(?!api\/|internal\/|agent-proxy\/ws|health$).*/, (_req, res) => {
    res.sendFile(path.join(desktopFrontendRoot, "index.html"));
  });
}

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
