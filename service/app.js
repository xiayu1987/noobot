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
import { prepareUserWorkspaces } from "./bootstrap/prepare-user-workspaces.js";
import {
  createThrottledProgressReporter,
  startStartupHeartbeat,
  writeStartupProgressEvent,
} from "./bootstrap/startup-progress.js";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  RUNTIME_EVENT_SCOPES,
  SERVICE_STARTUP_EVENTS,
  SERVICE_STARTUP_SOURCE,
  flushJsonLineBatches,
  writeRuntimeEvent,
} from "@noobot/runtime-events";

const app = express();
const {
  startupContext,
  appDependencies,
  connectorRuntime,
  connectorAccessPort,
  releaseConnectors,
} = await createHeadlessRuntime({ argv: process.argv, cwd: process.cwd() });

const desktopFrontendRoot = startupContext.paths.frontendRoot;
const shouldServeDesktopFrontend =
  startupContext.app.platform === "desktop" &&
  Boolean(desktopFrontendRoot) &&
  fs.existsSync(path.join(desktopFrontendRoot, "index.html"));

const {
  resolveRequestLocale,
  translateText,
  mapAgentRunCommand,
  resolveAuthByApiKey,
  normalizeLocale,
  defaultLocale,
  getBot,
  readSessionUserIds,
  buildHttpModuleDependencies,
  openVSCodeService,
} = appDependencies;

registerGlobalMiddlewares(app, {
  resolveRequestLocale,
  defaultLocale,
});

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

const stopStartupHeartbeat = startStartupHeartbeat();
try {
  const reportProgress = createThrottledProgressReporter({ write: writeStartupProgressEvent });
  const preparation = await prepareUserWorkspaces({
    userIds: await readSessionUserIds(),
    bot: getBot(),
    reportProgress,
  });
  reportProgress.flush();
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
      host: startupContext.service.host,
      port: startupContext.service.port,
    });
    await writeRuntimeEvent({
      scope: RUNTIME_EVENT_SCOPES.STARTUP,
      source: SERVICE_STARTUP_SOURCE,
      channel: RUNTIME_EVENT_CHANNELS.STARTUP,
      category: RUNTIME_EVENT_CATEGORIES.STATE,
      level: preparation.failures.length ? "error" : "info",
      event: preparation.failures.length
        ? SERVICE_STARTUP_EVENTS.WORKSPACE_PREPARATION_FAILED
        : SERVICE_STARTUP_EVENTS.WORKSPACE_PREPARATION_COMPLETED,
      data: preparation,
    });
  }
} catch (error) {
  const eventWrite = writeRuntimeEvent({
    scope: RUNTIME_EVENT_SCOPES.STARTUP,
    source: SERVICE_STARTUP_SOURCE,
    channel: RUNTIME_EVENT_CHANNELS.STARTUP,
    category: RUNTIME_EVENT_CATEGORIES.STATE,
    level: "error",
    event: SERVICE_STARTUP_EVENTS.FAILED,
    data: {
      code: String(error?.code || ""),
      message: String(error?.message || error || ""),
    },
  });
  await flushJsonLineBatches();
  await eventWrite;
  throw error;
} finally {
  stopStartupHeartbeat();
}
