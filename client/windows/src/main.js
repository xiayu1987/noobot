/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
const packagedBackendRoot = path.join(process.resourcesPath, "backend");

function getEarlyLogFilePath() {
  const base = process.platform === "win32"
    ? process.env.APPDATA || process.env.LOCALAPPDATA || process.env.TEMP || process.cwd()
    : process.env.XDG_CONFIG_HOME || process.env.HOME || process.env.TMPDIR || process.cwd();
  return path.join(base, "Noobot", "logs", "desktop-startup.log");
}

function appendEarlyLog(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    const logFile = getEarlyLogFilePath();
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, line, "utf8");
  } catch {
    // Diagnostics must not break startup.
  }
}

appendEarlyLog(`[main:module] loaded; node=${process.version}; electron=${process.versions.electron}; platform=${process.platform}; packaged=${app.isPackaged}; argv=${process.argv.join(" ")}`);

process.on("uncaughtException", (error) => {
  appendEarlyLog(`[process:uncaughtException] ${error?.stack || error?.message || String(error)}`);
});

process.on("unhandledRejection", (reason) => {
  appendEarlyLog(`[process:unhandledRejection] ${reason?.stack || reason?.message || String(reason)}`);
});

app.on("will-finish-launching", () => appendEarlyLog("[app:event] will-finish-launching"));
app.on("ready", () => appendEarlyLog("[app:event] ready"));
app.on("browser-window-created", () => appendEarlyLog("[app:event] browser-window-created"));
app.on("render-process-gone", (_event, _webContents, details) => {
  appendEarlyLog(`[app:event] render-process-gone reason=${details?.reason || ""} exitCode=${details?.exitCode ?? ""}`);
});
app.on("child-process-gone", (_event, details) => {
  appendEarlyLog(`[app:event] child-process-gone type=${details?.type || ""} reason=${details?.reason || ""} exitCode=${details?.exitCode ?? ""}`);
});
app.on("gpu-process-crashed", (_event, killed) => appendEarlyLog(`[app:event] gpu-process-crashed killed=${killed}`));

setTimeout(() => {
  appendEarlyLog(`[main:timer] 3000ms after module load; isReady=${app.isReady()}; whenReadyState=pending-or-resolved`);
}, 3000);

const servicePort = Number.parseInt(process.env.NOOBOT_SERVICE_PORT || "10061", 10);
const serviceOrigin = String(
  process.env.NOOBOT_SERVICE_URL || `http://127.0.0.1:${servicePort}`,
).replace(/\/$/, "");
const healthUrl = `${serviceOrigin}/health`;
const defaultClientUrl = process.env.NOOBOT_CLIENT_URL || "http://127.0.0.1:10060";
const startupTimeoutMs = Number.parseInt(process.env.NOOBOT_STARTUP_TIMEOUT_MS || "60000", 10);
const pollIntervalMs = Number.parseInt(process.env.NOOBOT_STARTUP_POLL_MS || "1000", 10);

let mainWindow = null;
let managedServiceProcess = null;
let serviceStartupPromise = null;
const startupStatuses = [];

function getLogFilePath() {
  return path.join(app.getPath("userData"), "logs", "desktop-startup.log");
}

function appendDesktopLog(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    const logFile = getLogFilePath();
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, line, "utf8");
  } catch {
    appendEarlyLog(`[main:app-log-fallback] ${message}`);
  }
}

function sendStatus(status) {
  startupStatuses.push(status);
  if (startupStatuses.length > 300) startupStatuses.shift();
  if (status?.message) appendDesktopLog(`[${status.phase || "status"}] ${status.message}`);
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("noobot:startup-status", status);
}

function createWindow() {
  appendDesktopLog("[main:create-window] creating startup window");
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: "Noobot",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    appendDesktopLog("[main:window] ready-to-show");
    mainWindow?.show();
  });
  mainWindow.webContents.once("did-finish-load", () => appendDesktopLog(`[main:window] did-finish-load ${mainWindow?.webContents.getURL() || ""}`));
  mainWindow.webContents.on("did-fail-load", (_event, code, description, url) => appendDesktopLog(`[main:window] did-fail-load code=${code} description=${description} url=${url}`));
  mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => appendDesktopLog(`[main:window] preload-error path=${preloadPath} error=${error?.stack || error?.message || String(error)}`));
  mainWindow.webContents.on("render-process-gone", (_event, details) => appendDesktopLog(`[main:window] render-process-gone reason=${details.reason} exitCode=${details.exitCode}`));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  const startupFile = path.join(__dirname, "startup.html");
  appendDesktopLog(`[main:create-window] loading ${startupFile}`);
  mainWindow.loadFile(startupFile).catch((error) => appendDesktopLog(`[main:create-window] loadFile failed: ${error?.stack || error?.message || String(error)}`));
  return mainWindow;
}

async function isServiceHealthy() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const response = await fetch(healthUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return false;
    const data = await response.json().catch(() => ({}));
    return data?.ok === true;
  } catch {
    return false;
  }
}

function startNoobotService() {
  if (managedServiceProcess) return;
  const isPackaged = app.isPackaged;
  const command = isPackaged ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
  const args = isPackaged ? [path.join(packagedBackendRoot, "service", "app.js")] : ["run", "-w", "service", "start"];
  const cwd = isPackaged ? packagedBackendRoot : repoRoot;
  const userDataPath = app.getPath("userData");
  sendStatus({
    phase: "starting",
    message: [
      `Starting Noobot service process...`,
      `command=${command}`,
      `args=${args.join(" ")}`,
      `cwd=${cwd}`,
      `log=${getLogFilePath()}`,
    ].join("\n"),
  });
  managedServiceProcess = spawn(command, args, {
    cwd,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: isPackaged ? "1" : process.env.ELECTRON_RUN_AS_NODE,
      PORT: String(servicePort),
      NOOBOT_DESKTOP: "1",
      NOOBOT_USER_DATA_DIR: userDataPath,
      NOOBOT_CONFIG_DIR: process.env.NOOBOT_CONFIG_DIR || path.join(userDataPath, "config"),
      NOOBOT_DATA_DIR: process.env.NOOBOT_DATA_DIR || path.join(userDataPath, "data"),
      NOOBOT_LOG_DIR: process.env.NOOBOT_LOG_DIR || path.join(userDataPath, "logs"),
    },
    stdio: "pipe",
    windowsHide: true,
  });

  managedServiceProcess.stdout?.on("data", (chunk) => {
    sendStatus({ phase: "service-log", message: chunk.toString() });
  });
  managedServiceProcess.stderr?.on("data", (chunk) => {
    sendStatus({ phase: "service-log", message: chunk.toString() });
  });
  managedServiceProcess.once("error", (error) => {
    managedServiceProcess = null;
    sendStatus({
      phase: "error",
      message: `Failed to start Noobot service process: ${error?.message || String(error)}`,
    });
  });
  managedServiceProcess.once("exit", (code, signal) => {
    const wasManaged = managedServiceProcess;
    managedServiceProcess = null;
    if (wasManaged && code !== 0 && code !== null) {
      sendStatus({
        phase: "error",
        message: `Noobot service exited early (code=${code}, signal=${signal || ""}).`,
      });
    }
  });
}

async function waitForHealthyService() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < startupTimeoutMs) {
    if (await isServiceHealthy()) return true;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return false;
}

async function ensureServiceStarted() {
  if (serviceStartupPromise) return serviceStartupPromise;
  serviceStartupPromise = (async () => {
    sendStatus({ phase: "checking", message: `Checking ${healthUrl}` });
    if (await isServiceHealthy()) {
      sendStatus({ phase: "ready", message: "Noobot service is already running." });
      return;
    }

    sendStatus({ phase: "starting", message: "Starting Noobot service..." });
    startNoobotService();
    const healthy = await waitForHealthyService();
    if (!healthy) {
      throw new Error(`Noobot service did not become healthy within ${startupTimeoutMs}ms.`);
    }
    sendStatus({ phase: "ready", message: "Noobot service is ready." });
  })().finally(() => {
    serviceStartupPromise = null;
  });
  return serviceStartupPromise;
}

async function resolveNoobotUrl() {
  // The current service does not serve the built Vue app. In packaged deployments this
  // may be changed to serviceOrigin once static hosting is added; for now, keep the
  // WebView pointed at the existing noobot-chat UI so its first-run configuration flow
  // remains the single source of truth.
  return defaultClientUrl;
}

async function boot() {
  appendDesktopLog("[main:boot] start");
  createWindow();
  try {
    await ensureServiceStarted();
    const noobotUrl = await resolveNoobotUrl();
    sendStatus({ phase: "loading", message: `Loading ${noobotUrl}` });
    await mainWindow.loadURL(noobotUrl);
  } catch (error) {
    sendStatus({
      phase: "error",
      message: error?.message || String(error),
      healthUrl,
      clientUrl: defaultClientUrl,
    });
  }
}

function stopManagedService() {
  if (!managedServiceProcess) return;
  const child = managedServiceProcess;
  managedServiceProcess = null;
  child.kill("SIGTERM");
}

ipcMain.handle("noobot:retry-startup", async () => {
  await ensureServiceStarted();
  const noobotUrl = await resolveNoobotUrl();
  await mainWindow?.loadURL(noobotUrl);
});

ipcMain.handle("noobot:get-startup-statuses", () => startupStatuses);

app.whenReady().then(boot);
app.on("window-all-closed", () => app.quit());
app.on("before-quit", stopManagedService);
