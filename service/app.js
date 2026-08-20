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
  getConnectorRegistry,
  initConnectorRegistry,
} from "#agent/connectors";
import { createAppDependencies } from "./bootstrap/create-app-dependencies.js";
import { registerGlobalMiddlewares } from "./bootstrap/register-global-middlewares.js";
import { registerHttpModules } from "./bootstrap/register-http-modules.js";
import { startHttpServer } from "./bootstrap/start-http-server.js";
import { createServiceGlobalConfigSource } from "./services/global-config-source.js";
import {
  applyStartupRuntimeEnv,
  loadStartupContext,
  safeStartupContextForLog,
} from "./services/startup-context-service.js";
import { buildWorkspaceTree } from "./services/workspace-tree-service.js";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  flushJsonLineBatches,
  writeRoutedRuntimeEvent,
} from "@noobot/runtime-events";

const app = express();
const startupContext = await loadStartupContext({ argv: process.argv, cwd: process.cwd() });
applyStartupRuntimeEnv(startupContext);
void writeRoutedRuntimeEvent({
  scope: "startup",
  source: "service",
  channel: RUNTIME_EVENT_CHANNELS.STARTUP,
  category: RUNTIME_EVENT_CATEGORIES.CONFIG,
  level: "debug",
  event: "service.startup.context.loaded",
  workspaceRoot: startupContext?.workspaceRoot,
  data: safeStartupContextForLog(startupContext),
});

const desktopFrontendRoot = String(
  startupContext?.paths?.frontendRoot ||
    process.env.NOOBOT_DESKTOP_FRONTEND_ROOT ||
    path.resolve(process.cwd(), "../frontend"),
).trim();
const shouldServeDesktopFrontend =
  process.env.NOOBOT_DESKTOP === "1" && fs.existsSync(path.join(desktopFrontendRoot, "index.html"));

const globalConfigSource = createServiceGlobalConfigSource();
const globalConfigBuilder = createGlobalConfigBuilder({
  source: globalConfigSource,
  sourceName: globalConfigSource.name,
});
const appDependencies = await createAppDependencies({
  startupContext,
  globalConfigBuilder,
  initConnectorRegistry,
  getConnectorChannelStore,
  getConnectorRegistry,
  buildWorkspaceTree,
});
const {
  resolveRequestLocale,
  translateText,
  mapAgentRunCommand,
  resolveAuthByApiKey,
  normalizeLocale,
  defaultLocale,
  workspaceRootPath,
  getBot,
  readSessionUserIds,
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
initConnectorRegistry({ workspaceRoot: workspaceRootPath() });

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

let shuttingDown = false;
let httpServer;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  stopManagedOpenVSCodeInstances();
  if (httpServer?.listening) {
    await new Promise((resolve) => httpServer.close(() => resolve()));
  }
  await flushJsonLineBatches();
  process.exit(signal === "SIGINT" ? 130 : 143);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  const results = [];
  for (const userId of await readSessionUserIds()) {
    results.push(await getBot().session.maintainSessionDisplaySummaries({ userId }));
  }
  const failures = results.flatMap((result) => result.failures || []);
  if (!shuttingDown) {
    httpServer = await startHttpServer({
      app,
      getBot,
      resolveRequestLocale,
      resolveAuthByApiKey,
      mapAgentRunCommand,
      normalizeLocale,
      defaultLocale,
      translateText,
      openVSCodeService,
      workspaceRootPath,
      host: startupContext.service.host || undefined,
      port: startupContext.service.port,
    });
    await writeRoutedRuntimeEvent({
      scope: "startup",
      source: "service",
      channel: RUNTIME_EVENT_CHANNELS.STARTUP,
      category: RUNTIME_EVENT_CATEGORIES.STATE,
      level: failures.length ? "error" : "info",
      event: failures.length
        ? "service.startup.sessionDisplaySummaryMaintenance.failed"
        : "service.startup.sessionDisplaySummaryMaintenance.completed",
      workspaceRoot: workspaceRootPath(),
      data: {
        userCount: results.length,
        migratedSessionCount: results.reduce(
          (count, result) => count + (result.migratedSessionIds?.length || 0),
          0,
        ),
        rebuiltSessionCount: results.reduce(
          (count, result) => count + (result.rebuiltSessionIds?.length || 0),
          0,
        ),
        failures,
      },
    });
  }
} catch (error) {
  const eventWrite = writeRoutedRuntimeEvent({
    scope: "startup",
    source: "service",
    channel: RUNTIME_EVENT_CHANNELS.STARTUP,
    category: RUNTIME_EVENT_CATEGORIES.STATE,
    level: "error",
    event: "service.startup.sessionDisplaySummaryMaintenance.failed",
    workspaceRoot: workspaceRootPath(),
    data: {
      code: String(error?.code || ""),
      message: String(error?.message || error || ""),
    },
  });
  await flushJsonLineBatches();
  await eventWrite;
  throw error;
}
