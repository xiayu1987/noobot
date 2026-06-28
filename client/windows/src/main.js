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
let bootStarted = false;
let pendingConfigResolve = null;
let desktopConfigState = null;
const startupStatuses = [];

function getLogFilePath() {
  return path.join(app.getPath("userData"), "logs", "desktop-startup.log");
}

function appendDesktopLog(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  appendEarlyLog(`[desktop-log:enter] ${message}`);
  try {
    const logFile = getLogFilePath();
    appendEarlyLog(`[desktop-log:path] ${logFile}`);
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, line, "utf8");
    appendEarlyLog(`[desktop-log:done] ${message}`);
  } catch {
    appendEarlyLog(`[main:app-log-fallback] ${message}`);
  }
}

function sendStatus(status) {
  appendEarlyLog(`[main:sendStatus] phase=${status?.phase || ""}; message=${String(status?.message || "").slice(0, 500)}`);
  startupStatuses.push(status);
  if (startupStatuses.length > 300) startupStatuses.shift();
  if (status?.message) appendDesktopLog(`[${status.phase || "status"}] ${status.message}`);
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("noobot:startup-status", status);
}

const desktopConfigSyncSkipTopLevelKeys = new Set([
  "workspace_root",
  "workspace_template_path",
  "streaming",
  "super_admin",
]);

function isPlainObject(input) {
  return input !== null && typeof input === "object" && !Array.isArray(input);
}

function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function deepClone(input) {
  return JSON.parse(JSON.stringify(input));
}

function mergeIncremental({ template, target, pathDepth = 0, skipTopLevelKeys = new Set() } = {}) {
  if (Array.isArray(template)) return target === undefined ? deepClone(template) : target;
  if (!isPlainObject(template)) return target === undefined ? template : target;
  const output = isPlainObject(target) ? deepClone(target) : {};
  const targetObject = isPlainObject(target) ? target : {};
  for (const [key, templateValue] of Object.entries(template)) {
    if (pathDepth === 0 && skipTopLevelKeys.has(key)) continue;
    if (!Object.prototype.hasOwnProperty.call(targetObject, key)) {
      output[key] = deepClone(templateValue);
    } else if (isPlainObject(templateValue) && isPlainObject(targetObject[key])) {
      output[key] = mergeIncremental({ template: templateValue, target: targetObject[key], pathDepth: pathDepth + 1, skipTopLevelKeys });
    } else {
      output[key] = targetObject[key];
    }
  }
  return output;
}

function copyDirectoryContents({ from, to }) {
  if (!fs.existsSync(from)) return false;
  fs.mkdirSync(to, { recursive: true });
  fs.cpSync(from, to, {
    recursive: true,
    filter: (src) => !["config.json", "global.config.json"].includes(path.basename(src)),
  });
  return true;
}

function collectTemplateVariables(input, keys = new Set()) {
  if (typeof input === "string") {
    for (const match of input.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) keys.add(match[1]);
  } else if (Array.isArray(input)) {
    input.forEach((item) => collectTemplateVariables(item, keys));
  } else if (isPlainObject(input)) {
    Object.values(input).forEach((value) => collectTemplateVariables(value, keys));
  }
  return keys;
}

function ensureConfigParamsCatalog({ workspaceRootPath, configFiles = [] } = {}) {
  const keys = new Set();
  for (const filePath of configFiles) collectTemplateVariables(readJsonFile(filePath, {}), keys);
  const filePath = path.join(workspaceRootPath, "config-params.json");
  const current = readJsonFile(filePath, {}) || {};
  const values = isPlainObject(current.values) ? { ...current.values } : {};
  const descriptions = isPlainObject(current.descriptions) ? { ...current.descriptions } : {};
  for (const key of Array.from(keys).sort((a, b) => a.localeCompare(b))) {
    if (!Object.prototype.hasOwnProperty.call(values, key)) values[key] = "";
    if (!Object.prototype.hasOwnProperty.call(descriptions, key)) descriptions[key] = "";
  }
  writeJsonFile(filePath, { values, descriptions });
  return filePath;
}

function getMissingRequiredConfigParams(configParamsPath) {
  const payload = readJsonFile(configParamsPath, {}) || {};
  const values = isPlainObject(payload.values) ? payload.values : {};
  return Object.entries(values)
    .filter(([, value]) => String(value ?? "").trim() === "")
    .map(([key]) => ({ key, description: String(payload.descriptions?.[key] || "") }));
}

function saveConfigParamValues({ workspaceRootPath, values = {} } = {}) {
  const filePath = path.join(workspaceRootPath, "config-params.json");
  const payload = readJsonFile(filePath, {}) || {};
  const currentValues = isPlainObject(payload.values) ? { ...payload.values } : {};
  const descriptions = isPlainObject(payload.descriptions) ? { ...payload.descriptions } : {};
  for (const [key, value] of Object.entries(values || {})) {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) continue;
    currentValues[normalizedKey] = String(value ?? "").trim();
    if (!Object.prototype.hasOwnProperty.call(descriptions, normalizedKey)) descriptions[normalizedKey] = "";
  }
  writeJsonFile(filePath, { values: currentValues, descriptions });
}

function syncJsonFileIncremental({ templateFilePath, targetFilePath, skipTopLevelKeys = new Set() } = {}) {
  const templateJson = readJsonFile(templateFilePath, null);
  if (!isPlainObject(templateJson)) return false;
  const targetExists = fs.existsSync(targetFilePath);
  const targetJson = targetExists ? readJsonFile(targetFilePath, {}) : {};
  const merged = mergeIncremental({ template: templateJson, target: targetJson, skipTopLevelKeys });
  if (!targetExists || JSON.stringify(targetJson) !== JSON.stringify(merged)) {
    writeJsonFile(targetFilePath, merged);
    return true;
  }
  return false;
}

function ensureDesktopGlobalConfig({ isPackaged, userDataPath }) {
  const configDir = process.env.NOOBOT_CONFIG_DIR || path.join(userDataPath, "config");
  const targetPath = process.env.NOOBOT_GLOBAL_CONFIG_PATH || path.join(configDir, "global.config.json");
  const examplePath = isPackaged
    ? path.join(packagedBackendRoot, "service", "config", "global.config.example.json")
    : path.join(repoRoot, "service", "config", "global.config.example.json");
  const bundledTemplatePath = isPackaged
    ? path.join(packagedBackendRoot, "user-template", "default-user")
    : path.join(repoRoot, "user-template", "default-user");
  const workspaceRootPath = process.env.NOOBOT_WORKSPACE_ROOT || path.join(userDataPath, "workspace");
  const workspaceTemplatePath = process.env.NOOBOT_WORKSPACE_TEMPLATE_PATH || path.join(userDataPath, "user-template", "default-user");

  const exampleConfig = readJsonFile(examplePath, null);
  if (!isPlainObject(exampleConfig)) throw new Error(`invalid global config example: ${examplePath}`);
  const currentConfig = fs.existsSync(targetPath) ? readJsonFile(targetPath, {}) : {};
  const mergedConfig = mergeIncremental({ template: exampleConfig, target: currentConfig, skipTopLevelKeys: desktopConfigSyncSkipTopLevelKeys });
  mergedConfig.workspace_root = workspaceRootPath;
  mergedConfig.workspace_template_path = workspaceTemplatePath;
  if (!fs.existsSync(targetPath) || JSON.stringify(currentConfig) !== JSON.stringify(mergedConfig)) {
    writeJsonFile(targetPath, mergedConfig);
    appendDesktopLog(`[main:config] synced global config from example: ${examplePath} -> ${targetPath}`);
  }

  copyDirectoryContents({ from: bundledTemplatePath, to: workspaceTemplatePath });
  const templateExamplePath = path.join(workspaceTemplatePath, "config.example.json");
  const templateConfigPath = path.join(workspaceTemplatePath, "config.json");
  if (fs.existsSync(templateExamplePath)) {
    syncJsonFileIncremental({ templateFilePath: templateExamplePath, targetFilePath: templateConfigPath, skipTopLevelKeys: desktopConfigSyncSkipTopLevelKeys });
  }
  fs.mkdirSync(workspaceRootPath, { recursive: true });
  const configParamsPath = ensureConfigParamsCatalog({
    workspaceRootPath,
    configFiles: [targetPath, templateConfigPath, templateExamplePath],
  });
  return { globalConfigPath: targetPath, workspaceRootPath, workspaceTemplatePath, configParamsPath, missingParams: getMissingRequiredConfigParams(configParamsPath) };
}

function requestMissingConfigParams(missingParams) {
  sendStatus({ phase: "config-required", message: "Please complete required configuration before starting Noobot.", params: missingParams });
  return new Promise((resolve) => {
    pendingConfigResolve = resolve;
  });
}

function createWindow() {
  appendEarlyLog("[main:create-window] enter");
  appendDesktopLog("[main:create-window] creating startup window");
  appendEarlyLog("[main:create-window] before BrowserWindow");
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: "Noobot",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  appendEarlyLog("[main:create-window] after BrowserWindow");

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
  appendEarlyLog(`[main:create-window] before loadFile ${startupFile}`);
  mainWindow.loadFile(startupFile).catch((error) => appendDesktopLog(`[main:create-window] loadFile failed: ${error?.stack || error?.message || String(error)}`));
  appendEarlyLog("[main:create-window] after loadFile call");
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
  const configDir = process.env.NOOBOT_CONFIG_DIR || path.join(userDataPath, "config");
  const configState = desktopConfigState || ensureDesktopGlobalConfig({ isPackaged, userDataPath });
  desktopConfigState = configState;
  const globalConfigPath = configState.globalConfigPath;
  sendStatus({
    phase: "starting",
    message: [
      `Starting Noobot service process...`,
      `command=${command}`,
      `args=${args.join(" ")}`,
      `cwd=${cwd}`,
      `log=${getLogFilePath()}`,
      `globalConfig=${globalConfigPath}`,
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
      NOOBOT_CONFIG_DIR: configDir,
      NOOBOT_DATA_DIR: process.env.NOOBOT_DATA_DIR || path.join(userDataPath, "data"),
      NOOBOT_LOG_DIR: process.env.NOOBOT_LOG_DIR || path.join(userDataPath, "logs"),
      NOOBOT_GLOBAL_CONFIG_PATH: globalConfigPath,
      NOOBOT_WORKSPACE_ROOT: configState.workspaceRootPath,
      NOOBOT_WORKSPACE_TEMPLATE_PATH: configState.workspaceTemplatePath,
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

    desktopConfigState = ensureDesktopGlobalConfig({ isPackaged: app.isPackaged, userDataPath: app.getPath("userData") });
    if (desktopConfigState.missingParams.length) {
      await requestMissingConfigParams(desktopConfigState.missingParams);
      desktopConfigState = ensureDesktopGlobalConfig({ isPackaged: app.isPackaged, userDataPath: app.getPath("userData") });
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

ipcMain.handle("noobot:save-config-params", (_event, values) => {
  const state = desktopConfigState || ensureDesktopGlobalConfig({ isPackaged: app.isPackaged, userDataPath: app.getPath("userData") });
  saveConfigParamValues({ workspaceRootPath: state.workspaceRootPath, values });
  desktopConfigState = ensureDesktopGlobalConfig({ isPackaged: app.isPackaged, userDataPath: app.getPath("userData") });
  if (desktopConfigState.missingParams.length) {
    sendStatus({ phase: "config-required", message: "Please complete all required configuration values.", params: desktopConfigState.missingParams });
    return { ok: false, missingParams: desktopConfigState.missingParams };
  }
  if (pendingConfigResolve) {
    const resolve = pendingConfigResolve;
    pendingConfigResolve = null;
    resolve();
  }
  return { ok: true };
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
