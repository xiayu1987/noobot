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
import { openStartupWorkspaceStorage } from "noobot-agent/workspace-session-storage";
import { closeRuntimeResources } from "./bootstrap/close-runtime-resources.js";
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
  flushRuntimeEvents,
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
  serviceBotAccess,
  readSessionUserIds,
  workspaceRootPath,
  buildHttpModuleDependencies,
  openVSCodeService,
} = appDependencies;

function stopManagedOpenVSCodeInstances() {
  openVSCodeService?.stopLifecycleManager?.({ stopInstances: true });
}

let shuttingDown = false;
let httpServer;
let resourceCleanup;
let storage;
let workspacePreparationSettled;
const startupController = new AbortController();

function closeResources() {
  if (!resourceCleanup)
    resourceCleanup = closeRuntimeResources({
      stopManagedInstances: stopManagedOpenVSCodeInstances,
      closeHttp: async () => {
        if (httpServer) await httpServer.close();
      },
      closeBot: async () => {
        await workspacePreparationSettled;
        await getBot().close();
      },
      releaseConnectors,
      flushEvents: async () => {
        try {
          await flushRuntimeEvents();
        } finally {
          await storage?.close();
        }
      },
    }).catch((cause) => {
      resourceCleanup = undefined;
      throw cause;
    });
  return resourceCleanup;
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  startupController.abort();
  await closeResources();
  process.exit(signal === "SIGINT" ? 130 : 143);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

const stopStartupHeartbeat = startStartupHeartbeat();
try {
  storage = await openStartupWorkspaceStorage(workspaceRootPath(), {
    signal: startupController.signal,
  });
  startupController.signal.throwIfAborted();
  registerGlobalMiddlewares(app, { resolveRequestLocale, defaultLocale });
  await registerHttpModules(app, { ...buildHttpModuleDependencies(), connectorRuntime });
  app.get("/health", (...[, res]) => res.json({ ok: true }));
  if (shouldServeDesktopFrontend) {
    app.use(express.static(desktopFrontendRoot));
    app.get(/^\/(?!api\/|internal\/|agent-proxy\/ws|health$).*/, (...[, res]) => {
      res.sendFile(path.join(desktopFrontendRoot, "index.html"));
    });
  }
  openVSCodeService?.startLifecycleManager?.();
  const reportProgress = createThrottledProgressReporter({
    write: writeStartupProgressEvent,
    now: () => performance.now(),
  });
  const preparingWorkspaces = prepareUserWorkspaces({
    userIds: await readSessionUserIds(),
    bot: getBot(),
    reportProgress,
    signal: startupController.signal,
    startupStorage: storage,
  });
  workspacePreparationSettled = Promise.allSettled([preparingWorkspaces]);
  const preparation = await preparingWorkspaces;
  await storage.finishStartup();
  reportProgress.flush();
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
  if (!shuttingDown) {
    httpServer = await startHttpServer({
      app,
      serviceBotAccess,
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
  const reporting = await Promise.allSettled([closeResources(), eventWrite]);
  const reportingErrors = reporting
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason);
  if (reportingErrors.length)
    throw new AggregateError(
      [error, ...reportingErrors],
      "Service startup, resource cleanup or failure logging failed",
      {
        cause: error,
      },
    );
  throw error;
} finally {
  stopStartupHeartbeat();
}
