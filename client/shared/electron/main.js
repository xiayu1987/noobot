/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { app } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendEarlyLog, createStartupLogger, desktopAppName, installEarlyDiagnostics } from "./startup-logging.js";
import { createDesktopConfigManager } from "./desktop-config.js";
import { registerFileIpcHandlers } from "./file-ipc.js";
import { createDesktopDependencyManager } from "./desktop-dependencies.js";
import { createDesktopServiceManager } from "./desktop-services.js";
import { createDesktopWindowManager } from "./desktop-window.js";
import { createStartupConfigRequesters, registerStartupIpcHandlers } from "./startup-ipc.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
const packagedBackendRoot = path.join(process.resourcesPath, "backend");

installEarlyDiagnostics({ filename: __filename, dirname: __dirname });

const servicePort = Number.parseInt(process.env.NOOBOT_SERVICE_PORT || "10061", 10);
const agentProxyPort = Number.parseInt(process.env.AGENT_PROXY_PORT || "10062", 10);
const serviceOrigin = String(
  process.env.NOOBOT_SERVICE_URL || `http://127.0.0.1:${servicePort}`,
).replace(/\/$/, "");
const healthUrl = `${serviceOrigin}/health`;
const agentProxyOrigin = String(
  process.env.NOOBOT_AGENT_PROXY_URL || `http://127.0.0.1:${agentProxyPort}`,
).replace(/\/$/, "");
const agentProxyHealthUrl = `${agentProxyOrigin}/health`;
const defaultClientUrl = process.env.NOOBOT_CLIENT_URL || "http://127.0.0.1:10060";
const startupTimeoutMs = Number.parseInt(process.env.NOOBOT_STARTUP_TIMEOUT_MS || "60000", 10);
const pollIntervalMs = Number.parseInt(process.env.NOOBOT_STARTUP_POLL_MS || "1000", 10);
const startupDebugEnabled = /^(1|true|yes|on)$/i.test(String(process.env.NOOBOT_STARTUP_DEBUG || ""));
const { appendDesktopLog, writeDependencyLog, writeStartupLog, getLogFilePath } = createStartupLogger({ startupDebugEnabled });

let bootStarted = false;
let pendingConfigResolve = null;
let pendingSuperAdminResolve = null;
let desktopConfigState = null;
const startupStatuses = [];

const { createWindow, resolveNoobotUrl, getMainWindow } = createDesktopWindowManager({
  app,
  dirname: __dirname,
  agentProxyOrigin,
  defaultClientUrl,
  appendEarlyLog,
  appendDesktopLog,
});

function sendStatus(status) {
  writeStartupLog("main", "status", { phase: status?.phase, dependency: status?.dependency, message: String(status?.message || "").slice(0, 500) });
  startupStatuses.push(status);
  if (startupStatuses.length > 300) startupStatuses.shift();
  if (status?.message) appendDesktopLog(`[${status.phase || "status"}] ${status.message}`);
  const currentWindow = getMainWindow();
  if (!currentWindow || currentWindow.isDestroyed()) {
    writeStartupLog("main", "status:no-window", { phase: status?.phase }, { debug: true });
    return;
  }
  setImmediate(() => {
    try {
      const targetWindow = getMainWindow();
      if (!targetWindow || targetWindow.isDestroyed()) {
        writeStartupLog("main", "status:ipc-no-window", { phase: status?.phase }, { debug: true });
        return;
      }
      targetWindow.webContents.send("noobot:startup-status", status);
    } catch (error) {
      writeStartupLog("main", "status:error", { error });
    }
  });
}

const { ensureDesktopGlobalConfig, saveConfigParamValues, saveSuperAdminConfig } = createDesktopConfigManager({ repoRoot, packagedBackendRoot, appendDesktopLog });

const { ensureSelectedDependencies } = createDesktopDependencyManager({
  app,
  appendEarlyLog,
  writeDependencyLog,
  sendStatus,
});

const { requestSuperAdminConfig, requestMissingConfigParams } = createStartupConfigRequesters({
  sendStatus,
  setPendingConfigResolve: (resolve) => { pendingConfigResolve = resolve; },
  setPendingSuperAdminResolve: (resolve) => { pendingSuperAdminResolve = resolve; },
});

const { ensureServiceStarted, stopManagedService } = createDesktopServiceManager({
  app,
  repoRoot,
  packagedBackendRoot,
  servicePort,
  agentProxyPort,
  serviceOrigin,
  healthUrl,
  agentProxyHealthUrl,
  startupTimeoutMs,
  pollIntervalMs,
  sendStatus,
  getLogFilePath,
  ensureDesktopGlobalConfig,
  getDesktopConfigState: () => desktopConfigState,
  setDesktopConfigState: (state) => { desktopConfigState = state; },
  requestSuperAdminConfig,
  requestMissingConfigParams,
});

async function boot() {
  appendEarlyLog(`[main:boot] enter; bootStarted=${bootStarted}`);
  if (bootStarted) {
    appendEarlyLog("[main:boot] skipped; already started");
    return;
  }
  bootStarted = true;
  appendEarlyLog("[main:boot] before appendDesktopLog start");
  appendDesktopLog("[main:boot] start");
  appendEarlyLog("[main:boot] before createWindow");
  createWindow();
  appendEarlyLog("[main:boot] after createWindow; before ensureServiceStarted");
  try {
    await ensureServiceStarted();
    appendEarlyLog("[main:boot] after ensureServiceStarted");
    const noobotUrl = await resolveNoobotUrl();
    sendStatus({ phase: "loading", message: `Loading ${noobotUrl}` });
    await getMainWindow()?.loadURL(noobotUrl);
  } catch (error) {
    sendStatus({
      phase: "error",
      message: error?.message || String(error),
      healthUrl,
      clientUrl: defaultClientUrl,
    });
  }
}

async function startBoot(reason) {
  appendEarlyLog(`[main:startBoot] requested; reason=${reason}; isReady=${app.isReady()}; bootStarted=${bootStarted}`);
  try {
    await boot();
    appendEarlyLog(`[main:startBoot] completed; reason=${reason}`);
  } catch (error) {
    appendEarlyLog(`[main:startBoot] failed; reason=${reason}; error=${error?.stack || error?.message || String(error)}`);
    throw error;
  }
}

registerFileIpcHandlers({ appendDesktopLog, getMainWindow });
registerStartupIpcHandlers({
  app,
  getStartupStatuses: () => startupStatuses,
  getDesktopConfigState: () => desktopConfigState,
  setDesktopConfigState: (state) => { desktopConfigState = state; },
  getPendingConfigResolve: () => pendingConfigResolve,
  setPendingConfigResolve: (resolve) => { pendingConfigResolve = resolve; },
  getPendingSuperAdminResolve: () => pendingSuperAdminResolve,
  setPendingSuperAdminResolve: (resolve) => { pendingSuperAdminResolve = resolve; },
  ensureDesktopGlobalConfig,
  saveConfigParamValues,
  saveSuperAdminConfig,
  ensureSelectedDependencies,
  ensureServiceStarted,
  resolveNoobotUrl,
  getMainWindow,
  sendStatus,
});

app.whenReady()
  .then(() => startBoot("whenReady"))
  .catch((error) => appendEarlyLog(`[main:whenReady] failed: ${error?.stack || error?.message || String(error)}`));

app.once("ready", () => {
  setImmediate(() => {
    if (!bootStarted) {
      startBoot("ready-event-fallback").catch(() => {});
    }
  });
});

setTimeout(() => {
  if (app.isReady() && !bootStarted) {
    startBoot("timer-fallback").catch(() => {});
  }
}, 5000);
app.on("window-all-closed", () => app.quit());
app.on("before-quit", stopManagedService);
