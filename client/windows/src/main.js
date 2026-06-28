/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
const packagedBackendRoot = path.join(process.resourcesPath, "backend");

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

function sendStatus(status) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("noobot:startup-status", status);
}

function createWindow() {
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

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.loadFile(path.join(__dirname, "startup.html"));
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

app.whenReady().then(boot);
app.on("window-all-closed", () => app.quit());
app.on("before-quit", stopManagedService);
