/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
const packagedBackendRoot = path.join(process.resourcesPath, "backend");
const desktopAppName = "Noobot";

app.setName(desktopAppName);

function getEarlyLogFilePath() {
  const base = process.platform === "win32"
    ? process.env.APPDATA || process.env.LOCALAPPDATA || process.env.TEMP || process.cwd()
    : process.env.XDG_CONFIG_HOME || process.env.HOME || process.env.TMPDIR || process.cwd();
  return path.join(base, desktopAppName, "logs", "desktop-startup.log");
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

let mainWindow = null;
let managedServiceProcess = null;
let managedAgentProxyProcess = null;
let serviceStartupPromise = null;
let bootStarted = false;
let pendingConfigResolve = null;
let pendingSuperAdminResolve = null;
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

function syncPackagedProxyConfig(proxyName) {
  if (!app.isPackaged) return;
  const examplePath = path.join(packagedBackendRoot, proxyName, `${proxyName}.config.example.json`);
  const configPath = path.join(packagedBackendRoot, proxyName, `${proxyName}.config.json`);
  if (fs.existsSync(configPath)) return;
  if (!fs.existsSync(examplePath)) {
    sendStatus({ phase: "warning", message: `Skipped ${proxyName} config sync; example config not found: ${examplePath}` });
    return;
  }
  fs.copyFileSync(examplePath, configPath);
  sendStatus({ phase: "config", message: `Synced ${proxyName} config from example: ${examplePath} -> ${configPath}` });
}

function syncPackagedProxyConfigs() {
  syncPackagedProxyConfig("agent-proxy");
  syncPackagedProxyConfig("model-proxy");
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

function getNestedString(root, segments) {
  let node = root;
  for (const segment of segments) node = isPlainObject(node) ? node[segment] : undefined;
  return String(node ?? "").trim();
}

function setNestedValue(root, segments, value) {
  let node = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (!isPlainObject(node[segment])) node[segment] = {};
    node = node[segment];
  }
  node[segments[segments.length - 1]] = value;
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
    for (const match of input.matchAll(/\$\{([A-Z0-9_]+)\}/g)) keys.add(match[1]);
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

function getSuperAdminRequirement(globalConfigPath) {
  const payload = readJsonFile(globalConfigPath, {}) || {};
  const userId = getNestedString(payload, ["super_admin", "user_id"]);
  const connectCode = getNestedString(payload, ["super_admin", "connect_code"]);
  const language = getNestedString(payload, ["preferences", "language"]) || "zh-CN";
  const missing = !userId || !connectCode || userId === "admin" || connectCode === "change-your-connect-code";
  return { missing, userId: userId === "admin" ? "" : userId, connectCode: connectCode === "change-your-connect-code" ? "" : connectCode, language };
}

function normalizeDesktopLanguage(language) {
  const value = String(language ?? "").trim();
  if (["zh-CN", "en-US"].includes(value)) return value;
  if (value.toLowerCase().startsWith("en")) return "en-US";
  return "zh-CN";
}

function saveSuperAdminConfig({ globalConfigPath, userId, connectCode, language } = {}) {
  const normalizedUserId = String(userId ?? "").trim();
  const normalizedConnectCode = String(connectCode ?? "").trim();
  const normalizedLanguage = normalizeDesktopLanguage(language);
  if (!normalizedUserId) throw new Error("Super admin username is required.");
  if (!normalizedConnectCode) throw new Error("Super admin connect code is required.");
  if (normalizedUserId === "admin") throw new Error("Please change the default super admin username.");
  if (normalizedConnectCode === "change-your-connect-code") throw new Error("Please change the default connect code.");
  const payload = readJsonFile(globalConfigPath, {}) || {};
  setNestedValue(payload, ["super_admin", "user_id"], normalizedUserId);
  setNestedValue(payload, ["super_admin", "connect_code"], normalizedConnectCode);
  setNestedValue(payload, ["preferences", "language"], normalizedLanguage);
  writeJsonFile(globalConfigPath, payload);
}

function saveConfigParamValues({ workspaceRootPath, values = {} } = {}) {
  const filePath = path.join(workspaceRootPath, "config-params.json");
  const payload = readJsonFile(filePath, {}) || {};
  const currentValues = isPlainObject(payload.values) ? { ...payload.values } : {};
  const descriptions = isPlainObject(payload.descriptions) ? { ...payload.descriptions } : {};
  for (const [key, value] of Object.entries(values || {})) {
    const normalizedKey = String(key || "").trim().toUpperCase();
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

function forceExecuteScriptNonSandbox(configPath) {
  const payload = readJsonFile(configPath, null);
  if (!isPlainObject(payload)) return false;
  setNestedValue(payload, ["tools", "execute_script", "sandbox_mode"], false);
  writeJsonFile(configPath, payload);
  return true;
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
  const isFirstGlobalConfig = !fs.existsSync(targetPath);
  const currentConfig = isFirstGlobalConfig ? {} : readJsonFile(targetPath, {});
  const mergedConfig = mergeIncremental({ template: exampleConfig, target: currentConfig, skipTopLevelKeys: desktopConfigSyncSkipTopLevelKeys });
  mergedConfig.workspace_root = workspaceRootPath;
  mergedConfig.workspace_template_path = workspaceTemplatePath;
  if (isFirstGlobalConfig) setNestedValue(mergedConfig, ["tools", "execute_script", "sandbox_mode"], false);
  if (!fs.existsSync(targetPath) || JSON.stringify(currentConfig) !== JSON.stringify(mergedConfig)) {
    writeJsonFile(targetPath, mergedConfig);
    appendDesktopLog(`[main:config] synced global config from example: ${examplePath} -> ${targetPath}`);
  }

  copyDirectoryContents({ from: bundledTemplatePath, to: workspaceTemplatePath });
  const templateExamplePath = path.join(workspaceTemplatePath, "config.example.json");
  const templateConfigPath = path.join(workspaceTemplatePath, "config.json");
  if (fs.existsSync(templateExamplePath)) {
    const isFirstUserConfig = !fs.existsSync(templateConfigPath);
    syncJsonFileIncremental({ templateFilePath: templateExamplePath, targetFilePath: templateConfigPath, skipTopLevelKeys: desktopConfigSyncSkipTopLevelKeys });
    if (isFirstUserConfig) {
      forceExecuteScriptNonSandbox(templateConfigPath);
      appendDesktopLog(`[main:config] initialized desktop default user config with non-sandbox execute_script: ${templateConfigPath}`);
    }
  }
  fs.mkdirSync(workspaceRootPath, { recursive: true });
  const configParamsPath = ensureConfigParamsCatalog({
    workspaceRootPath,
    configFiles: [targetPath, templateConfigPath, templateExamplePath],
  });
  return {
    globalConfigPath: targetPath,
    workspaceRootPath,
    workspaceTemplatePath,
    configParamsPath,
    superAdmin: getSuperAdminRequirement(targetPath),
    missingParams: getMissingRequiredConfigParams(configParamsPath),
  };
}

function requestSuperAdminConfig(superAdmin) {
  sendStatus({
    phase: "super-admin-required",
    message: "Please set the super admin username and connect code before starting Noobot.",
    superAdmin,
  });
  return new Promise((resolve) => {
    pendingSuperAdminResolve = resolve;
  });
}

function requestMissingConfigParams(missingParams) {
  sendStatus({ phase: "config-optional", message: "Optional configuration variables can be filled now or skipped.", params: missingParams });
  return new Promise((resolve) => {
    pendingConfigResolve = resolve;
  });
}

function createWindow() {
  appendEarlyLog("[main:create-window] enter");
  appendDesktopLog("[main:create-window] creating startup window");
  appendEarlyLog("[main:create-window] before BrowserWindow");
  const windowIconPath = process.env.NOOBOT_DESKTOP_WINDOW_ICON || path.join(__dirname, "..", "..", "windows", "assets", "noobot.ico");
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: "Noobot",
    icon: windowIconPath,
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

async function isAgentProxyHealthy() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const response = await fetch(agentProxyHealthUrl, { signal: controller.signal });
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

function startAgentProxy() {
  if (managedAgentProxyProcess) return;
  const isPackaged = app.isPackaged;
  const command = isPackaged ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
  const args = isPackaged ? [path.join(packagedBackendRoot, "agent-proxy", "agent-proxy.js")] : ["run", "-w", "agent-proxy", "start"];
  const cwd = isPackaged ? packagedBackendRoot : repoRoot;
  const frontendRoot = isPackaged ? path.join(process.resourcesPath, "frontend") : "";
  sendStatus({
    phase: "starting",
    message: [
      `Starting Noobot agent proxy process...`,
      `command=${command}`,
      `args=${args.join(" ")}`,
      `cwd=${cwd}`,
      `health=${agentProxyHealthUrl}`,
      `frontend=${frontendRoot || "dev-server"}`,
    ].join("\n"),
  });
  managedAgentProxyProcess = spawn(command, args, {
    cwd,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: isPackaged ? "1" : process.env.ELECTRON_RUN_AS_NODE,
      AGENT_PROXY_PORT: String(agentProxyPort),
      AGENT_PROXY_HOST: "127.0.0.1",
      AGENT_PROXY_UPSTREAM_HTTP_BASE: serviceOrigin,
      AGENT_PROXY_UPSTREAM_WS_URL: `ws://127.0.0.1:${servicePort}/chat/ws`,
      AGENT_PROXY_FRONTEND_ROOT: frontendRoot,
      AGENT_PROXY_HTTP_RATE_LIMIT_ENABLED: "0",
      AGENT_PROXY_WS_RATE_LIMIT_ENABLED: "0",
    },
    stdio: "pipe",
    windowsHide: true,
  });
  managedAgentProxyProcess.stdout?.on("data", (chunk) => sendStatus({ phase: "agent-proxy-log", message: chunk.toString() }));
  managedAgentProxyProcess.stderr?.on("data", (chunk) => sendStatus({ phase: "agent-proxy-log", message: chunk.toString() }));
  managedAgentProxyProcess.once("error", (error) => {
    managedAgentProxyProcess = null;
    sendStatus({ phase: "error", message: `Failed to start Noobot agent proxy process: ${error?.message || String(error)}` });
  });
  managedAgentProxyProcess.once("exit", (code, signal) => {
    const wasManaged = managedAgentProxyProcess;
    managedAgentProxyProcess = null;
    if (wasManaged && code !== 0 && code !== null) {
      sendStatus({ phase: "error", message: `Noobot agent proxy exited early (code=${code}, signal=${signal || ""}).` });
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

async function waitForHealthyAgentProxy() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < startupTimeoutMs) {
    if (await isAgentProxyHealthy()) return true;
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
    if (desktopConfigState.superAdmin?.missing) {
      await requestSuperAdminConfig(desktopConfigState.superAdmin);
      desktopConfigState = ensureDesktopGlobalConfig({ isPackaged: app.isPackaged, userDataPath: app.getPath("userData") });
    }
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
    if (app.isPackaged) {
      sendStatus({ phase: "starting", message: "Starting Noobot agent proxy..." });
      syncPackagedProxyConfigs();
      if (!(await isAgentProxyHealthy())) startAgentProxy();
      const proxyHealthy = await waitForHealthyAgentProxy();
      if (!proxyHealthy) throw new Error(`Noobot agent proxy did not become healthy within ${startupTimeoutMs}ms.`);
      sendStatus({ phase: "ready", message: "Noobot agent proxy is ready." });
    }
  })().finally(() => {
    serviceStartupPromise = null;
  });
  return serviceStartupPromise;
}

async function resolveNoobotUrl() {
  if (app.isPackaged) {
    const packagedFrontendIndex = path.join(process.resourcesPath, "frontend", "index.html");
    if (fs.existsSync(packagedFrontendIndex)) return agentProxyOrigin;
    appendDesktopLog(`[main:frontend] packaged frontend not found: ${packagedFrontendIndex}`);
  }

  // Development keeps loading the Vite dev server so frontend hot reload remains usable.
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
  if (managedAgentProxyProcess) {
    const child = managedAgentProxyProcess;
    managedAgentProxyProcess = null;
    child.kill("SIGTERM");
  }
  if (!managedServiceProcess) return;
  const child = managedServiceProcess;
  managedServiceProcess = null;
  child.kill("SIGTERM");
}

function sanitizeDownloadFileName(fileName = "") {
  const value = String(fileName || "download").trim() || "download";
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/\.+$/g, "_").slice(0, 180) || "download";
}

function normalizeDownloadBytes(bytes) {
  if (!bytes) throw new Error("Missing download content.");
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof ArrayBuffer) return Buffer.from(new Uint8Array(bytes));
  if (ArrayBuffer.isView(bytes)) {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  if (Array.isArray(bytes)) return Buffer.from(bytes);
  if (typeof bytes === "object" && bytes?.type === "Buffer" && Array.isArray(bytes?.data)) {
    return Buffer.from(bytes.data);
  }
  throw new Error("Unsupported download content.");
}

function sanitizeFileAccessLogPayload(payload = {}) {
  const input = payload && typeof payload === "object" ? payload : { message: String(payload || "") };
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      output[key] = value;
      continue;
    }
    if (value instanceof Error) {
      output[key] = value.message;
      continue;
    }
    try {
      output[key] = JSON.stringify(value).slice(0, 1000);
    } catch {
      output[key] = String(value).slice(0, 1000);
    }
  }
  return output;
}

function maskHostPath(pathValue = "") {
  const normalized = String(pathValue || "").trim().replaceAll("\\", "/");
  if (!normalized) return "";
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 2) return normalized;
  return `${parts[0]}/.../${parts.at(-1)}`;
}

function logHostFileAccess(event, payload = {}) {
  appendDesktopLog(`[noobot:file-access] ${JSON.stringify(sanitizeFileAccessLogPayload({
    layer: "electron.main",
    event,
    channel: "desktop-host-ipc",
    ...payload,
  }))}`);
}

async function resolveHostFile(pathValue = "") {
  const targetPath = String(pathValue || "").trim();
  if (!targetPath) {
    const error = new Error("Missing host file path.");
    error.code = "missing_path";
    throw error;
  }
  if (!path.isAbsolute(targetPath)) {
    const error = new Error("Host file path must be absolute.");
    error.code = "not_absolute";
    throw error;
  }
  const stats = await fs.promises.stat(targetPath);
  if (!stats.isFile()) {
    const error = new Error("Host path is not a file.");
    error.code = "not_file";
    throw error;
  }
  return { targetPath, stats };
}

ipcMain.handle("noobot:save-download", async (_event, { fileName = "download", bytes } = {}) => {
  const buffer = normalizeDownloadBytes(bytes);
  const defaultPath = path.join(app.getPath("downloads"), sanitizeDownloadFileName(fileName));
  const result = await dialog.showSaveDialog(mainWindow || undefined, {
    defaultPath,
    properties: ["createDirectory", "showOverwriteConfirmation"],
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  await fs.promises.mkdir(path.dirname(result.filePath), { recursive: true });
  await fs.promises.writeFile(result.filePath, buffer);
  return { ok: true, filePath: result.filePath };
});

ipcMain.handle("noobot:file-access-log", (_event, payload = {}) => {
  appendDesktopLog(`[noobot:file-access] ${JSON.stringify(sanitizeFileAccessLogPayload(payload))}`);
  return { ok: true };
});

ipcMain.handle("noobot:read-host-file", async (_event, { path: pathValue = "", traceId = "" } = {}) => {
  const hostPath = String(pathValue || "").trim();
  try {
    logHostFileAccess("host.read.request", { traceId, hostPath: maskHostPath(hostPath), hasPath: Boolean(hostPath) });
    const { targetPath, stats } = await resolveHostFile(hostPath);
    const buffer = await fs.promises.readFile(targetPath);
    const isText = !buffer.includes(0);
    const content = isText ? buffer.toString("utf8") : "";
    logHostFileAccess("host.read.response", { traceId, hostPath: maskHostPath(targetPath), isText, size: stats.size });
    return { ok: true, path: targetPath, fileName: path.basename(targetPath), isText, size: stats.size, content };
  } catch (error) {
    logHostFileAccess("host.read.failed", { traceId, hostPath: maskHostPath(hostPath), errorCode: error?.code || "host_read_failed", error: error?.message || String(error) });
    return { ok: false, errorCode: error?.code || "host_read_failed", error: error?.message || String(error) };
  }
});

ipcMain.handle("noobot:download-host-file", async (_event, { path: pathValue = "", traceId = "" } = {}) => {
  const hostPath = String(pathValue || "").trim();
  try {
    logHostFileAccess("host.download.request", { traceId, hostPath: maskHostPath(hostPath), hasPath: Boolean(hostPath) });
    const { targetPath, stats } = await resolveHostFile(hostPath);
    const fileName = path.basename(targetPath);
    const defaultPath = path.join(app.getPath("downloads"), sanitizeDownloadFileName(fileName));
    const result = await dialog.showSaveDialog(mainWindow || undefined, {
      defaultPath,
      properties: ["createDirectory", "showOverwriteConfirmation"],
    });
    if (result.canceled || !result.filePath) {
      logHostFileAccess("host.download.response", { traceId, hostPath: maskHostPath(targetPath), canceled: true, size: stats.size });
      return { ok: false, canceled: true, fileName, size: stats.size };
    }
    await fs.promises.mkdir(path.dirname(result.filePath), { recursive: true });
    await fs.promises.copyFile(targetPath, result.filePath);
    logHostFileAccess("host.download.response", { traceId, hostPath: maskHostPath(targetPath), savedPath: maskHostPath(result.filePath), size: stats.size });
    return { ok: true, path: targetPath, savedPath: result.filePath, fileName, size: stats.size };
  } catch (error) {
    logHostFileAccess("host.download.failed", { traceId, hostPath: maskHostPath(hostPath), errorCode: error?.code || "host_download_failed", error: error?.message || String(error) });
    return { ok: false, errorCode: error?.code || "host_download_failed", error: error?.message || String(error) };
  }
});

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
  if (pendingConfigResolve) {
    const resolve = pendingConfigResolve;
    pendingConfigResolve = null;
    resolve();
  }
  return { ok: true };
});

ipcMain.handle("noobot:skip-config-params", () => {
  if (pendingConfigResolve) {
    const resolve = pendingConfigResolve;
    pendingConfigResolve = null;
    resolve();
  }
  return { ok: true };
});

ipcMain.handle("noobot:save-super-admin", (_event, values = {}) => {
  const state = desktopConfigState || ensureDesktopGlobalConfig({ isPackaged: app.isPackaged, userDataPath: app.getPath("userData") });
  saveSuperAdminConfig({ globalConfigPath: state.globalConfigPath, userId: values.userId, connectCode: values.connectCode, language: values.language });
  desktopConfigState = ensureDesktopGlobalConfig({ isPackaged: app.isPackaged, userDataPath: app.getPath("userData") });
  if (desktopConfigState.superAdmin?.missing) {
    sendStatus({ phase: "super-admin-required", message: "Please complete super admin setup.", superAdmin: desktopConfigState.superAdmin });
    return { ok: false, superAdmin: desktopConfigState.superAdmin };
  }
  if (pendingSuperAdminResolve) {
    const resolve = pendingSuperAdminResolve;
    pendingSuperAdminResolve = null;
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
