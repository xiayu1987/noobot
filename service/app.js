/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { createHeadlessRuntime } from "./bootstrap/create-headless-runtime.js";
import { registerGlobalMiddlewares } from "./bootstrap/register-global-middlewares.js";
import { registerHttpModules } from "./bootstrap/register-http-modules.js";
import { startHttpServer } from "./bootstrap/start-http-server.js";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  flushJsonLineBatches,
  writeRoutedRuntimeEvent,
} from "@noobot/runtime-events";

const app = express();
const {
  startupContext,
  appDependencies,
  connectorRuntime,
  connectorAccessPort,
  releaseConnectors,
} = await createHeadlessRuntime({ argv: process.argv, cwd: process.cwd() });

const desktopFrontendRoot = String(
  startupContext?.paths?.frontendRoot ||
    process.env.NOOBOT_DESKTOP_FRONTEND_ROOT ||
    path.resolve(process.cwd(), "../frontend"),
).trim();
const shouldServeDesktopFrontend =
  process.env.NOOBOT_DESKTOP === "1" && fs.existsSync(path.join(desktopFrontendRoot, "index.html"));

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

await registerHttpModules(app, { ...buildHttpModuleDependencies(), connectorRuntime });

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
  await releaseConnectors();
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
      connectorAccessPort,
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
