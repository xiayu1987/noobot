/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { app } from "electron";
import { clientFilePath as path } from "../path-resolver.js";
import { fileURLToPath } from "node:url";
import { appendEarlyLog, createStartupLogger, desktopAppName, installEarlyDiagnostics } from "./startup-logging.js";
import { createDesktopConfigManager } from "./desktop-config.js";
import { registerFileIpcHandlers } from "./file-ipc.js";
import { createDesktopDependencyManager } from "./desktop-dependencies.js";
import { createDesktopServiceManager } from "./desktop-services.js";
import { createDesktopWindowManager } from "./desktop-window.js";
import { createDesktopBootstrap } from "./desktop-bootstrap.js";
import { createStartupConfigRequesters, registerStartupIpcHandlers } from "./startup-ipc.js";
import { createDependencyProcessTools } from "./dependency-process.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(process.env.NOOBOT_DESKTOP_REPO_ROOT || path.resolve(__dirname, "../../.."));
const packagedBackendRoot = path.join(process.resourcesPath, "backend");

installEarlyDiagnostics({ app, filename: __filename, dirname: __dirname });

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
const {
  appendDesktopLog,
  appendStartupLog,
  appendServiceLog,
  appendAgentProxyLog,
  writeDependencyLog,
  writeStartupLog,
  getLogFilePath,
} = createStartupLogger({ app, startupDebugEnabled });

let pendingConfigResolve = null;
let pendingSuperAdminResolve = null;
let desktopConfigState = null;
const startupStatuses = [];

const { createWindow, resolveNoobotUrl, reloadWebContents, getMainWindow } = createDesktopWindowManager({
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
  if (status?.message) {
    if (status.phase !== "service-log" && status.phase !== "agent-proxy-log") {
      appendStartupLog(`[${status.phase || "status"}] ${status.message}`);
    }
  }
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
const { runProcess: runDependencyProcess } = createDependencyProcessTools({ appendEarlyLog });

const { ensureSelectedDependencies } = createDesktopDependencyManager({
  app,
  appendEarlyLog,
  writeDependencyLog,
  sendStatus,
  getDependencyProxyUrl: () => String(desktopConfigState?.superAdmin?.dependencyProxyUrl || ""),
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
  appendServiceLog,
  appendAgentProxyLog,
  ensureDesktopGlobalConfig,
  getDesktopConfigState: () => desktopConfigState,
  setDesktopConfigState: (state) => { desktopConfigState = state; },
  requestSuperAdminConfig,
  requestMissingConfigParams,
});

const { boot, hasBootStarted } = createDesktopBootstrap({
  createWindow,
  ensureServiceStarted,
  resolveNoobotUrl,
  getMainWindow,
  sendStatus,
  appendEarlyLog,
  appendDesktopLog,
  appendStartupLog,
  healthUrl,
  defaultClientUrl,
});

async function startBoot(reason) {
  appendEarlyLog(`[main:startBoot] requested; reason=${reason}; isReady=${app.isReady()}; bootStarted=${hasBootStarted()}`);
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
  reloadWebContents,
  resolveNoobotUrl,
  getMainWindow,
  sendStatus,
  runProcess: runDependencyProcess,
});

app.whenReady()
  .then(() => startBoot("whenReady"))
  .catch((error) => appendEarlyLog(`[main:whenReady] failed: ${error?.stack || error?.message || String(error)}`));

app.once("ready", () => {
  setImmediate(() => {
    if (!hasBootStarted()) {
      startBoot("ready-event-fallback").catch(() => {});
    }
  });
});

setTimeout(() => {
  if (app.isReady() && !hasBootStarted()) {
    startBoot("timer-fallback").catch(() => {});
  }
}, 5000);
app.on("window-all-closed", () => app.quit());
app.on("before-quit", stopManagedService);
