/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
const packagedBackendRoot = path.join(process.resourcesPath, "backend");
const desktopAppName = "Noobot";
const desktopDependencyTimeouts = Object.freeze({
  commandProbeMs: 15000,
  checkMs: 45000,
  packageQueryMs: 30000,
  installCommandMs: 15000,
  downloadMs: 15 * 60 * 1000,
  dmgAttachMs: 2 * 60 * 1000,
  appCopyMs: 10 * 60 * 1000,
  dmgDetachMs: 60 * 1000,
  installMs: 20 * 60 * 1000,
});

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
    fs.promises.mkdir(path.dirname(logFile), { recursive: true })
      .then(() => fs.promises.appendFile(logFile, line, "utf8"))
      .catch(() => {});
  } catch {
    // Diagnostics must not break startup.
  }
}

function appendFallbackDebugLog(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  const candidates = [
    path.join(process.env.HOME || process.cwd(), `${desktopAppName}-startup-debug.log`),
    path.join(process.env.TMPDIR || "/tmp", `${desktopAppName}-startup-debug.log`),
  ];
  for (const filePath of candidates) {
    try {
      fs.promises.appendFile(filePath, line, "utf8").catch(() => {});
    } catch {
      // Diagnostics must not break startup.
    }
  }
}

function appendStartupTrace(message) {
  appendEarlyLog(message);
  appendFallbackDebugLog(message);
}

appendEarlyLog(`[main:module] loaded; node=${process.version}; electron=${process.versions.electron}; platform=${process.platform}; packaged=${app.isPackaged}; filename=${__filename}; execPath=${process.execPath}; resourcesPath=${process.resourcesPath || ""}; argv=${process.argv.join(" ")}`);
appendFallbackDebugLog(`[main:module] loaded; node=${process.version}; electron=${process.versions.electron}; platform=${process.platform}; packaged=${app.isPackaged}; filename=${__filename}; execPath=${process.execPath}; resourcesPath=${process.resourcesPath || ""}; argv=${process.argv.join(" ")}`);

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
const startupDebugEnabled = /^(1|true|yes|on)$/i.test(String(process.env.NOOBOT_STARTUP_DEBUG || ""));

let mainWindow = null;
let managedServiceProcess = null;
let managedAgentProxyProcess = null;
let serviceStartupPromise = null;
let bootStarted = false;
let pendingConfigResolve = null;
let pendingSuperAdminResolve = null;
let desktopConfigState = null;
const startupStatuses = [];

const dependencySpecs = {
  libreoffice: {
    label: "LibreOffice",
    checkCommands: ["libreoffice", "soffice"],
    win32ExecutableCandidates: [
      "LibreOffice\\program\\soffice.exe",
      "LibreOffice\\program\\libreoffice.exe",
      "The Document Foundation\\LibreOffice\\program\\soffice.exe",
      "The Document Foundation\\LibreOffice\\program\\libreoffice.exe",
    ],
    win32RegistryKeys: [
      "HKLM\\SOFTWARE\\LibreOffice\\UNO\\InstallPath",
      "HKLM\\SOFTWARE\\WOW6432Node\\LibreOffice\\UNO\\InstallPath",
      "HKCU\\SOFTWARE\\LibreOffice\\UNO\\InstallPath",
    ],
    win32WingetPackages: ["TheDocumentFoundation.LibreOffice"],
    packages: {
      win32: { winget: "TheDocumentFoundation.LibreOffice", choco: "libreoffice-fresh" },
      darwin: { brew: "libreoffice" },
      linux: { apt: "libreoffice", dnf: "libreoffice", yum: "libreoffice", pacman: "libreoffice-fresh" },
    },
    darwinAppBundle: "LibreOffice.app",
    darwinDmg: {
      version: process.env.NOOBOT_LIBREOFFICE_MAC_VERSION || "",
      url: process.env.NOOBOT_LIBREOFFICE_MAC_DMG_URL || "",
    },
  },
  ffmpeg: {
    label: "FFmpeg",
    checkCommands: ["ffmpeg"],
    managedCommand: "ffmpeg",
    win32ExecutableCandidates: [
      "ffmpeg\\bin\\ffmpeg.exe",
      "Gyan\\FFmpeg\\bin\\ffmpeg.exe",
      "Gyan\\ffmpeg\\bin\\ffmpeg.exe",
      "chocolatey\\bin\\ffmpeg.exe",
    ],
    win32WingetPackages: ["Gyan.FFmpeg"],
    packages: {
      win32: { winget: "Gyan.FFmpeg", choco: "ffmpeg" },
      darwin: { brew: "ffmpeg" },
      linux: { apt: "ffmpeg", dnf: "ffmpeg", yum: "ffmpeg", pacman: "ffmpeg" },
    },
    darwinManaged: {
      url: process.env.NOOBOT_FFMPEG_MAC_URL || "",
      manualUrl: "https://evermeet.cx/ffmpeg/",
    },
  },
  nodejs: {
    label: "Node.js",
    checkCommands: ["node"],
    managedCommand: "node",
    win32ExecutableCandidates: [
      "nodejs\\node.exe",
      "node\\node.exe",
      "node.exe",
      "chocolatey\\bin\\node.exe",
    ],
    win32RegistryKeys: [
      "HKLM\\SOFTWARE\\Node.js",
      "HKLM\\SOFTWARE\\WOW6432Node\\Node.js",
      "HKCU\\SOFTWARE\\Node.js",
    ],
    win32WingetPackages: ["OpenJS.NodeJS.LTS", "OpenJS.NodeJS"],
    packages: {
      win32: { winget: "OpenJS.NodeJS.LTS", choco: "nodejs-lts" },
      darwin: { brew: "node" },
      linux: { apt: "nodejs", dnf: "nodejs", yum: "nodejs", pacman: "nodejs" },
    },
    darwinManaged: {
      version: process.env.NOOBOT_NODEJS_MAC_VERSION || "",
      url: process.env.NOOBOT_NODEJS_MAC_URL || "",
      manualUrl: "https://nodejs.org/en/download",
    },
  },
};

function formatLogValue(value) {
  if (value === undefined || value === null) return "";
  if (value instanceof Error) return value.stack || value.message || String(value);
  if (typeof value === "object") {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}

function formatLogFields(fields = {}) {
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${formatLogValue(value).replace(/\s+/g, " ").slice(0, 1200)}`)
    .join("; ");
}

function writeStartupLog(scope, event, fields = {}, { debug = false } = {}) {
  if (debug && !startupDebugEnabled) return;
  const detail = formatLogFields(fields);
  appendStartupTrace(`[${scope}:${event}]${detail ? ` ${detail}` : ""}`);
}

function writeDependencyLog(event, fields = {}, options = {}) {
  writeStartupLog("dependency", event, fields, options);
}

function getLogFilePath() {
  return path.join(app.getPath("userData"), "logs", "desktop-startup.log");
}

function appendDesktopLog(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    const logFile = getLogFilePath();
    fs.promises.mkdir(path.dirname(logFile), { recursive: true })
      .then(() => fs.promises.appendFile(logFile, line, "utf8"))
      .catch((error) => writeStartupLog("desktop-log", "error", { message, error }, { debug: true }));
  } catch {
    writeStartupLog("desktop-log", "fallback", { message }, { debug: true });
  }
}

function sendStatus(status) {
  writeStartupLog("main", "status", { phase: status?.phase, dependency: status?.dependency, message: String(status?.message || "").slice(0, 500) });
  startupStatuses.push(status);
  if (startupStatuses.length > 300) startupStatuses.shift();
  if (status?.message) appendDesktopLog(`[${status.phase || "status"}] ${status.message}`);
  if (!mainWindow || mainWindow.isDestroyed()) {
    writeStartupLog("main", "status:no-window", { phase: status?.phase }, { debug: true });
    return;
  }
  setImmediate(() => {
    try {
      if (!mainWindow || mainWindow.isDestroyed()) {
        writeStartupLog("main", "status:ipc-no-window", { phase: status?.phase }, { debug: true });
        return;
      }
      mainWindow.webContents.send("noobot:startup-status", status);
    } catch (error) {
      writeStartupLog("main", "status:error", { error });
    }
  });
}

function runProcess(command, args = [], { timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const commandLine = [command, ...args].join(" ");
    appendEarlyLog(`[process:start] ${commandLine}; timeoutMs=${timeoutMs}`);
    let settled = false;
    let child = null;
    let timer = null;
    let stdout = "";
    let stderr = "";
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      appendEarlyLog(`[process:finish] ${commandLine}; ok=${payload.ok}; code=${payload.code ?? ""}; elapsedMs=${Date.now() - startedAt}; error=${payload.error || ""}`);
      resolve(payload);
    };
    timer = setTimeout(() => {
      appendEarlyLog(`[process:timeout] ${commandLine}; killing child`);
      try { child?.kill(); } catch {}
      finish({ ok: false, code: -1, stdout, stderr, error: `Timed out after ${timeoutMs}ms` });
    }, timeoutMs);
    try {
      child = spawn(command, args, { windowsHide: true, shell: false });
    } catch (error) {
      finish({ ok: false, code: -1, stdout, stderr, error: error?.message || String(error) });
      return;
    }
    child.stdout?.on("data", (chunk) => { stdout += String(chunk || ""); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk || ""); });
    child.on("error", (error) => {
      finish({ ok: false, code: -1, stdout, stderr, error: error?.message || String(error) });
    });
    child.on("close", (code) => {
      finish({ ok: code === 0, code, stdout, stderr });
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getManagedDependenciesRoot() {
  const base = app.isReady() ? app.getPath("userData") : (process.env.HOME || os.tmpdir());
  return path.join(base, "managed-dependencies");
}

function getManagedDependencyDir(key) {
  return path.join(getManagedDependenciesRoot(), key);
}

function getManagedBinDirs() {
  return [
    path.join(getManagedDependencyDir("ffmpeg"), "bin"),
    path.join(getManagedDependencyDir("nodejs"), "bin"),
  ];
}

function getDarwinManagedKeyForSpec(spec) {
  if (spec === dependencySpecs.ffmpeg) return "ffmpeg";
  if (spec === dependencySpecs.nodejs) return "nodejs";
  return "";
}

function prependManagedDependencyPath() {
  if (process.platform !== "darwin") return;
  const delimiter = path.delimiter;
  const current = String(process.env.PATH || "");
  const parts = current.split(delimiter).filter(Boolean);
  const managed = getManagedBinDirs().filter((dir) => hasExistingFile(dir));
  const next = [...managed, ...parts.filter((part) => !managed.includes(part))].join(delimiter);
  if (next && next !== current) {
    process.env.PATH = next;
    writeDependencyLog("managed:path", { dirs: managed.join(" | ") });
  }
}

function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  return new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      appendEarlyLog(`[timeout] label=${label}; timeoutMs=${timeoutMs}`);
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => {
        if (timer) clearTimeout(timer);
      });
  });
}

function compareVersionDesc(a, b) {
  const left = String(a || "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = String(b || "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (right[index] || 0) - (left[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function getMacLibreOfficeDmgUrlForVersion(version) {
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  return `https://download.documentfoundation.org/libreoffice/stable/${version}/mac/${arch}/LibreOffice_${version}_MacOS_${arch}.dmg`;
}

function getMacLibreOfficeDmgUrl(spec) {
  const configuredUrl = String(spec.darwinDmg?.url || "").trim();
  if (configuredUrl) return configuredUrl;
  const version = String(spec.darwinDmg?.version || "").trim();
  return version ? getMacLibreOfficeDmgUrlForVersion(version) : "";
}

async function fetchLibreOfficeStableVersions() {
  const indexUrl = "https://download.documentfoundation.org/libreoffice/stable/";
  writeDependencyLog("dmg:versions:start", { url: indexUrl });
  const result = await runProcess("curl", ["-L", "--fail", "--silent", "--show-error", "--connect-timeout", "30", indexUrl], {
    timeoutMs: desktopDependencyTimeouts.packageQueryMs,
  });
  writeDependencyLog("dmg:versions:finish", { ok: result.ok, code: result.code, error: result.error });
  if (!result.ok) return [];
  const versions = Array.from(new Set(
    String(result.stdout || "")
      .matchAll(/href=["'](\d+\.\d+\.\d+)\/["']/gi)
      .map((match) => match[1]),
  )).sort(compareVersionDesc);
  writeDependencyLog("dmg:versions:list", { versions: versions.join(",") });
  return versions;
}

async function getMacLibreOfficeDmgUrlCandidates(spec) {
  const configuredUrl = String(spec.darwinDmg?.url || "").trim();
  if (configuredUrl) return [configuredUrl];

  const candidates = [];
  const configuredVersion = String(spec.darwinDmg?.version || "").trim();
  if (configuredVersion) candidates.push(getMacLibreOfficeDmgUrlForVersion(configuredVersion));

  const stableVersions = await fetchLibreOfficeStableVersions();
  for (const version of stableVersions) candidates.push(getMacLibreOfficeDmgUrlForVersion(version));

  // Last-resort fallbacks for offline directory parsing or transient index failures.
  for (const version of ["26.2.4", "26.2.3", "26.2.2", "25.8.7", "25.8.6"]) {
    candidates.push(getMacLibreOfficeDmgUrlForVersion(version));
  }
  return Array.from(new Set(candidates.filter(Boolean)));
}

function findLibreOfficeAppInVolume(volumePath) {
  const direct = path.join(volumePath, "LibreOffice.app");
  if (hasExistingFile(direct)) return direct;
  try {
    const entries = fs.readdirSync(volumePath, { withFileTypes: true });
    const match = entries.find((entry) => entry.isDirectory() && entry.name.toLowerCase() === "libreoffice.app");
    return match ? path.join(volumePath, match.name) : "";
  } catch {
    return "";
  }
}

function parseHdiutilMountPoint(output) {
  const lines = String(output || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/(\/Volumes\/.+)$/);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

async function downloadFileWithCurl(url, destinationPath, { timeoutMs, label = "file", eventPrefix = "download" } = {}) {
  writeDependencyLog(`${eventPrefix}:start`, { url, destination: destinationPath, timeoutMs });
  const result = await runProcess("curl", ["-L", "--fail", "--show-error", "--connect-timeout", "30", "-o", destinationPath, url], { timeoutMs });
  writeDependencyLog(`${eventPrefix}:finish`, { ok: result.ok, code: result.code, error: result.error });
  if (!result.ok) {
    const detail = String(result.stderr || result.stdout || result.error || "").trim().slice(0, 1000);
    const error = new Error(`Failed to download ${label}.${detail ? ` ${detail}` : ""}`);
    error.failureKind = "download";
    error.retryable = true;
    throw error;
  }
}

function createDependencyError(message, { failureKind = "local", retryable = false, cause } = {}) {
  const error = new Error(message);
  error.failureKind = failureKind;
  error.retryable = retryable === true;
  if (cause) error.cause = cause;
  return error;
}

function getDependencyErrorMeta(error, defaults = {}) {
  return {
    failureKind: error?.failureKind || defaults.failureKind || "local",
    retryable: error?.retryable === true || defaults.retryable === true,
  };
}

async function downloadFirstAvailableLibreOfficeDmg(spec, destinationPath) {
  const candidates = await getMacLibreOfficeDmgUrlCandidates(spec);
  const failures = [];
  writeDependencyLog("dmg:download:candidates", { count: candidates.length, urls: candidates.join(" | ") });
  for (const url of candidates) {
    try {
      await fs.promises.rm(destinationPath, { force: true });
      await downloadFileWithCurl(url, destinationPath, { timeoutMs: desktopDependencyTimeouts.downloadMs, label: "LibreOffice DMG", eventPrefix: "dmg:download" });
      return url;
    } catch (error) {
      const message = error?.message || String(error);
      failures.push(`${url} => ${message.slice(0, 500)}`);
      writeDependencyLog("dmg:download:candidate-failed", { url, error: message.slice(0, 1000) });
      await fs.promises.rm(destinationPath, { force: true }).catch(() => {});
    }
  }
  throw createDependencyError(`Failed to download LibreOffice DMG from official candidates. Tried: ${failures.join(" ; ")}. You can set NOOBOT_LIBREOFFICE_MAC_DMG_URL to a verified LibreOffice macOS DMG URL, or install manually from https://www.libreoffice.org/download/download-libreoffice/`, { failureKind: "download", retryable: true });
}

async function installLibreOfficeFromDmg(spec) {
  if (process.platform !== "darwin" || spec.label !== "LibreOffice") return null;
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "noobot-libreoffice-"));
  const dmgPath = path.join(tempDir, "LibreOffice.dmg");
  let mountPoint = "";
  try {
    sendStatus({ phase: "dependency", message: `Downloading ${spec.label} from the official LibreOffice site...` });
    const dmgUrl = await downloadFirstAvailableLibreOfficeDmg(spec, dmgPath);
    writeDependencyLog("dmg:download:selected", { url: dmgUrl });

    sendStatus({ phase: "dependency", message: `Mounting ${spec.label} installer...` });
    writeDependencyLog("dmg:attach:start", { path: dmgPath, timeoutMs: desktopDependencyTimeouts.dmgAttachMs });
    const attachResult = await runProcess("hdiutil", ["attach", dmgPath, "-nobrowse", "-readonly"], { timeoutMs: desktopDependencyTimeouts.dmgAttachMs });
    writeDependencyLog("dmg:attach:finish", { ok: attachResult.ok, code: attachResult.code, error: attachResult.error });
    if (!attachResult.ok) {
      const detail = String(attachResult.stderr || attachResult.stdout || attachResult.error || "").trim().slice(0, 1000);
      throw createDependencyError(`Failed to mount LibreOffice DMG.${detail ? ` ${detail}` : ""}`, { failureKind: "package" });
    }
    mountPoint = parseHdiutilMountPoint(`${attachResult.stdout || ""}\n${attachResult.stderr || ""}`);
    writeDependencyLog("dmg:mount-point", { path: mountPoint });
    if (!mountPoint) throw createDependencyError("Failed to locate LibreOffice DMG mount point.", { failureKind: "package" });

    const sourceApp = findLibreOfficeAppInVolume(mountPoint);
    writeDependencyLog("dmg:app-source", { path: sourceApp });
    if (!sourceApp) throw createDependencyError("Mounted LibreOffice DMG did not contain LibreOffice.app.", { failureKind: "package" });

    const targetApp = "/Applications/LibreOffice.app";
    sendStatus({ phase: "dependency", message: `Copying ${spec.label} to /Applications...` });
    writeDependencyLog("dmg:copy:start", { source: sourceApp, target: targetApp, timeoutMs: desktopDependencyTimeouts.appCopyMs });
    const copyResult = await runProcess("ditto", [sourceApp, targetApp], { timeoutMs: desktopDependencyTimeouts.appCopyMs });
    writeDependencyLog("dmg:copy:finish", { ok: copyResult.ok, code: copyResult.code, error: copyResult.error });
    if (!copyResult.ok) {
      const detail = String(copyResult.stderr || copyResult.stdout || copyResult.error || "").trim().slice(0, 1000);
      throw createDependencyError(`Failed to copy LibreOffice to /Applications. macOS may require permission to write to /Applications.${detail ? ` ${detail}` : ""}`, { failureKind: "permission" });
    }
    return { ok: true, method: "dmg" };
  } finally {
    if (mountPoint) {
      sendStatus({ phase: "dependency", message: `Unmounting ${spec.label} installer...` });
      writeDependencyLog("dmg:detach:start", { mount: mountPoint, timeoutMs: desktopDependencyTimeouts.dmgDetachMs });
      const detachResult = await runProcess("hdiutil", ["detach", mountPoint], { timeoutMs: desktopDependencyTimeouts.dmgDetachMs });
      writeDependencyLog("dmg:detach:finish", { ok: detachResult.ok, code: detachResult.code, error: detachResult.error });
    }
    fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function getMacNodeArch() {
  return process.arch === "arm64" ? "arm64" : "x64";
}

function getMacNodeTarUrlForVersion(version) {
  const normalized = String(version || "").trim().replace(/^v?/, "v");
  return `https://nodejs.org/dist/${normalized}/node-${normalized}-darwin-${getMacNodeArch()}.tar.xz`;
}

function getMacManagedCommandPath(key, command) {
  if (process.platform !== "darwin") return "";
  return path.join(getManagedDependencyDir(key), "bin", command);
}

async function runManagedCommand(key, command, args = []) {
  const commandPath = getMacManagedCommandPath(key, command);
  if (!commandPath || !hasExistingFile(commandPath)) return { ok: false, error: "managed command missing" };
  return runProcess(commandPath, args, { timeoutMs: desktopDependencyTimeouts.commandProbeMs });
}

function getFileMode(filePath) {
  try {
    return fs.statSync(filePath).mode.toString(8);
  } catch {
    return "";
  }
}

async function findExecutableFileByName(rootDir, fileName) {
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name === fileName) return fullPath;
    }
  }
  return "";
}

async function verifyManagedCommand(key, command, args = ["--version"]) {
  const commandPath = getMacManagedCommandPath(key, command);
  const exists = hasExistingFile(commandPath);
  const mode = exists ? getFileMode(commandPath) : "";
  const result = exists
    ? await runProcess(commandPath, args, { timeoutMs: desktopDependencyTimeouts.commandProbeMs })
    : { ok: false, code: -1, stdout: "", stderr: "", error: "managed command missing" };
  writeDependencyLog("managed:verify", {
    key,
    command,
    path: commandPath,
    exists,
    mode,
    ok: result.ok,
    code: result.code,
    error: result.error,
    stderr: String(result.stderr || "").slice(0, 500),
    pathEnv: String(process.env.PATH || "").slice(0, 1000),
  });
  return { ...result, path: commandPath, exists, mode };
}

async function downloadFirstAvailableFile({ key, label, candidates, destinationPath, eventPrefix, manualUrl, envHint }) {
  const failures = [];
  writeDependencyLog(`${eventPrefix}:candidates`, { key, count: candidates.length, urls: candidates.join(" | ") });
  for (const url of candidates) {
    try {
      await fs.promises.rm(destinationPath, { force: true });
      await downloadFileWithCurl(url, destinationPath, { timeoutMs: desktopDependencyTimeouts.downloadMs, label, eventPrefix });
      return url;
    } catch (error) {
      const message = error?.message || String(error);
      failures.push(`${url} => ${message.slice(0, 500)}`);
      writeDependencyLog(`${eventPrefix}:candidate-failed`, { key, url, error: message.slice(0, 1000) });
      await fs.promises.rm(destinationPath, { force: true }).catch(() => {});
    }
  }
  throw createDependencyError(`Failed to download ${label}. Tried: ${failures.join(" ; ")}.${envHint ? ` You can set ${envHint}.` : ""}${manualUrl ? ` Manual download: ${manualUrl}` : ""}`, { failureKind: "download", retryable: true });
}

function getMacFfmpegUrlCandidates(spec) {
  const configuredUrl = String(spec.darwinManaged?.url || "").trim();
  return Array.from(new Set([
    configuredUrl,
    "https://evermeet.cx/ffmpeg/getrelease/zip",
    "https://evermeet.cx/ffmpeg/ffmpeg.zip",
  ].filter(Boolean)));
}

async function installFfmpegManagedMac(spec) {
  if (process.platform !== "darwin") return null;
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "noobot-ffmpeg-"));
  const archivePath = path.join(tempDir, "ffmpeg.zip");
  const extractDir = path.join(tempDir, "extract");
  const targetBinDir = path.join(getManagedDependencyDir("ffmpeg"), "bin");
  const targetPath = path.join(targetBinDir, "ffmpeg");
  try {
    sendStatus({ phase: "dependency", message: `Downloading ${spec.label} binary...` });
    const selectedUrl = await downloadFirstAvailableFile({
      key: "ffmpeg",
      label: "FFmpeg",
      candidates: getMacFfmpegUrlCandidates(spec),
      destinationPath: archivePath,
      eventPrefix: "managed:ffmpeg:download",
      manualUrl: spec.darwinManaged?.manualUrl,
      envHint: "NOOBOT_FFMPEG_MAC_URL",
    });
    writeDependencyLog("managed:ffmpeg:download:selected", { url: selectedUrl });
    await fs.promises.mkdir(extractDir, { recursive: true });
    sendStatus({ phase: "dependency", message: `Extracting ${spec.label}...` });
    const unzipResult = await runProcess("ditto", ["-x", "-k", archivePath, extractDir], { timeoutMs: desktopDependencyTimeouts.installMs });
    if (!unzipResult.ok) throw createDependencyError(`Failed to extract FFmpeg.${String(unzipResult.stderr || unzipResult.error || "").slice(0, 1000)}`, { failureKind: "package" });
    const sourcePath = await findExecutableFileByName(extractDir, "ffmpeg");
    writeDependencyLog("managed:ffmpeg:binary", { source: sourcePath, target: targetPath });
    if (!sourcePath) throw createDependencyError("FFmpeg archive did not contain ffmpeg binary.", { failureKind: "package" });
    await fs.promises.rm(path.dirname(targetBinDir), { recursive: true, force: true });
    await fs.promises.mkdir(targetBinDir, { recursive: true });
    await fs.promises.copyFile(sourcePath, targetPath);
    await fs.promises.chmod(targetPath, 0o755);
    prependManagedDependencyPath();
    const verify = await verifyManagedCommand("ffmpeg", "ffmpeg", ["-version"]);
    if (!verify.ok) throw createDependencyError(`Managed FFmpeg verification failed at ${verify.path || targetPath}. exists=${verify.exists}; mode=${verify.mode}; ${String(verify.stderr || verify.error || "").slice(0, 1000)}`, { failureKind: "verification" });
    return { ok: true, method: "managed", path: verify.path };
  } finally {
    fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function getMacNodeUrlCandidates(spec) {
  const configuredUrl = String(spec.darwinManaged?.url || "").trim();
  const configuredVersion = String(spec.darwinManaged?.version || "").trim();
  const versions = [configuredVersion, "v22.21.1", "v20.19.5", "v24.11.1"].filter(Boolean);
  return Array.from(new Set([configuredUrl, ...versions.map(getMacNodeTarUrlForVersion)].filter(Boolean)));
}

async function installNodeManagedMac(spec) {
  if (process.platform !== "darwin") return null;
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "noobot-nodejs-"));
  const archivePath = path.join(tempDir, "node.tar.xz");
  const extractDir = path.join(tempDir, "extract");
  const targetDir = getManagedDependencyDir("nodejs");
  try {
    sendStatus({ phase: "dependency", message: `Downloading ${spec.label} from nodejs.org...` });
    const selectedUrl = await downloadFirstAvailableFile({
      key: "nodejs",
      label: "Node.js",
      candidates: getMacNodeUrlCandidates(spec),
      destinationPath: archivePath,
      eventPrefix: "managed:nodejs:download",
      manualUrl: spec.darwinManaged?.manualUrl,
      envHint: "NOOBOT_NODEJS_MAC_URL or NOOBOT_NODEJS_MAC_VERSION",
    });
    writeDependencyLog("managed:nodejs:download:selected", { url: selectedUrl });
    await fs.promises.mkdir(extractDir, { recursive: true });
    sendStatus({ phase: "dependency", message: `Extracting ${spec.label}...` });
    const tarResult = await runProcess("tar", ["-xJf", archivePath, "-C", extractDir, "--strip-components", "1"], { timeoutMs: desktopDependencyTimeouts.installMs });
    if (!tarResult.ok) throw createDependencyError(`Failed to extract Node.js.${String(tarResult.stderr || tarResult.error || "").slice(0, 1000)}`, { failureKind: "package" });
    await fs.promises.rm(targetDir, { recursive: true, force: true });
    await fs.promises.mkdir(path.dirname(targetDir), { recursive: true });
    await fs.promises.rename(extractDir, targetDir);
    await fs.promises.chmod(path.join(targetDir, "bin", "node"), 0o755).catch(() => {});
    await fs.promises.chmod(path.join(targetDir, "bin", "npm"), 0o755).catch(() => {});
    prependManagedDependencyPath();
    const nodeVerify = await verifyManagedCommand("nodejs", "node", ["--version"]);
    if (!nodeVerify.ok) throw createDependencyError(`Managed Node.js verification failed.${String(nodeVerify.stderr || nodeVerify.error || "").slice(0, 1000)}`, { failureKind: "verification" });
    const npmVerify = await runManagedCommand("nodejs", "npm", ["--version"]);
    writeDependencyLog("managed:nodejs:npm:verify", { ok: npmVerify.ok, error: npmVerify.error });
    return { ok: true, method: "managed" };
  } finally {
    fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function installManagedDependencyMac(key, spec) {
  if (process.platform !== "darwin") return null;
  if (key === "ffmpeg") return installFfmpegManagedMac(spec);
  if (key === "nodejs") return installNodeManagedMac(spec);
  return null;
}

async function hasCommand(command) {
  if (process.platform === "darwin") prependManagedDependencyPath();
  appendEarlyLog(`[dependency:probe:start] command=${command}`);
  const result = await runProcess(command, ["--version"], {
    timeoutMs: desktopDependencyTimeouts.commandProbeMs,
  });
  appendEarlyLog(`[dependency:probe:finish] command=${command}; ok=${result.ok}; error=${result.error || ""}`);
  return result.ok;
}

function hasExistingFile(filePath) {
  try {
    return Boolean(filePath) && fs.existsSync(filePath);
  } catch (error) {
    appendEarlyLog(`[fs:exists:error] path=${filePath || ""}; error=${error?.message || String(error)}`);
    return false;
  }
}

function hasMacAppBundle(appName) {
  if (process.platform !== "darwin") return false;
  const candidates = [
    path.join("/Applications", appName),
    path.join(process.env.HOME || "", "Applications", appName),
  ].filter(Boolean);
  appendEarlyLog(`[dependency:installed:mac-app:start] app=${appName}; candidates=${candidates.join(" | ")}`);
  for (const candidate of candidates) {
    appendEarlyLog(`[dependency:installed:mac-app:path] app=${appName}; path=${candidate}`);
    const exists = hasExistingFile(candidate);
    appendEarlyLog(`[dependency:installed:mac-app:path-result] app=${appName}; path=${candidate}; exists=${exists}`);
    if (exists) {
      appendEarlyLog(`[dependency:installed:mac-app:finish] app=${appName}; installed=true; path=${candidate}`);
      return true;
    }
  }
  appendEarlyLog(`[dependency:installed:mac-app:finish] app=${appName}; installed=false`);
  return false;
}

function parseWindowsRegistryDefaultValue(output) {
  const lines = String(output || "").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*\(Default\)\s+REG_\w+\s+(.+)\s*$/i)
      || line.match(/^\s*默认\s+REG_\w+\s+(.+)\s*$/i);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

async function hasWindowsRegistryInstallPath(spec) {
  for (const registryKey of spec.win32RegistryKeys || []) {
    const result = await runProcess("reg", ["query", registryKey], {
      timeoutMs: desktopDependencyTimeouts.commandProbeMs,
    });
    if (!result.ok) continue;
    const installPath = parseWindowsRegistryDefaultValue(result.stdout);
    if (!installPath) continue;
    const candidates = [
      path.join(installPath, "soffice.exe"),
      path.join(installPath, "libreoffice.exe"),
      path.join(installPath, "program", "soffice.exe"),
      path.join(installPath, "program", "libreoffice.exe"),
    ];
    if (candidates.some(hasExistingFile)) return true;
  }
  return false;
}

async function hasWindowsWingetPackage(spec) {
  if (!spec.win32WingetPackages?.length || !(await findAvailableCommand(["winget"]))) return false;
  for (const packageId of spec.win32WingetPackages) {
    const result = await runProcess("winget", ["list", "--id", packageId, "--exact", "--accept-source-agreements"], {
      timeoutMs: desktopDependencyTimeouts.packageQueryMs,
    });
    if (result.ok && String(result.stdout || "").toLowerCase().includes(packageId.toLowerCase())) return true;
  }
  return false;
}

async function isDependencyInstalled(spec) {
  appendEarlyLog(`[dependency:installed:start] label=${spec.label}; platform=${process.platform}`);
  if (process.platform === "darwin" && spec.managedCommand) {
    const managedKey = getDarwinManagedKeyForSpec(spec);
    const managedPath = managedKey ? getMacManagedCommandPath(managedKey, spec.managedCommand) : "";
    if (hasExistingFile(managedPath)) {
      const result = await runProcess(managedPath, ["--version"], { timeoutMs: desktopDependencyTimeouts.commandProbeMs });
      if (result.ok) {
        prependManagedDependencyPath();
        appendEarlyLog(`[dependency:installed:finish] label=${spec.label}; installed=true; via=managed; path=${managedPath}`);
        return true;
      }
    }
  }
  if (process.platform === "darwin" && spec.darwinAppBundle) {
    appendEarlyLog(`[dependency:installed:mac-app] label=${spec.label}; app=${spec.darwinAppBundle}`);
    if (hasMacAppBundle(spec.darwinAppBundle)) {
      appendEarlyLog(`[dependency:installed:finish] label=${spec.label}; installed=true; via=mac-app`);
      return true;
    }
  }
  for (const command of spec.checkCommands || []) {
    appendEarlyLog(`[dependency:installed:command] label=${spec.label}; command=${command}`);
    const installed = await hasCommand(command);
    appendEarlyLog(`[dependency:installed:command-result] label=${spec.label}; command=${command}; installed=${installed}`);
    if (installed) {
      appendEarlyLog(`[dependency:installed:finish] label=${spec.label}; installed=true; via=command; command=${command}`);
      return true;
    }
  }
  if (process.platform === "win32") {
    if (await hasWindowsRegistryInstallPath(spec)) return true;
    const roots = [
      process.env.ProgramFiles,
      process.env["ProgramFiles(x86)"],
      process.env.ProgramData,
      process.env.LOCALAPPDATA,
      process.env.APPDATA,
      "C:\\",
    ]
      .filter(Boolean);
    for (const root of roots) {
      for (const relative of spec.win32ExecutableCandidates || []) {
        if (hasExistingFile(path.join(root, relative))) return true;
      }
    }
    if (await hasWindowsWingetPackage(spec)) return true;
  }
  appendEarlyLog(`[dependency:installed:finish] label=${spec.label}; installed=false`);
  return false;
}

async function waitForDependencyInstalled(spec, { timeoutMs = 90000, intervalMs = 3000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (await isDependencyInstalled(spec)) return true;
    await sleep(intervalMs);
  }
  return false;
}

async function findAvailableCommand(commands = []) {
  writeDependencyLog("find-command:start", { commands: commands.join(",") }, { debug: true });
  for (const command of commands) {
    writeDependencyLog("find-command:probe", { command }, { debug: true });
    if (await hasCommand(command)) {
      writeDependencyLog("find-command:found", { command });
      return command;
    }
  }
  writeDependencyLog("find-command:missing", { commands: commands.join(",") });
  return "";
}

async function buildDependencyInstallCommand(spec) {
  writeDependencyLog("install-command:build:start", { label: spec.label, platform: process.platform }, { debug: true });
  const packages = spec.packages?.[process.platform] || {};
  if (process.platform === "win32") {
    if (packages.winget && await findAvailableCommand(["winget"])) return { command: "winget", args: ["install", "--id", packages.winget, "--exact", "--accept-package-agreements", "--accept-source-agreements"] };
    if (packages.choco && await findAvailableCommand(["choco"])) return { command: "choco", args: ["install", packages.choco, "-y"] };
  }
  if (process.platform === "darwin") {
    if (packages.brew && await findAvailableCommand(["brew"])) return { command: "brew", args: ["install", "--cask", packages.brew] };
  }
  if (process.platform === "linux") {
    if (packages.apt && await findAvailableCommand(["apt-get"])) {
      const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
      return isRoot ? { command: "apt-get", args: ["install", "-y", packages.apt] } : { command: "sudo", args: ["-n", "apt-get", "install", "-y", packages.apt] };
    }
    const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
    if (packages.dnf && await findAvailableCommand(["dnf"])) return isRoot ? { command: "dnf", args: ["install", "-y", packages.dnf] } : { command: "sudo", args: ["-n", "dnf", "install", "-y", packages.dnf] };
    if (packages.yum && await findAvailableCommand(["yum"])) return isRoot ? { command: "yum", args: ["install", "-y", packages.yum] } : { command: "sudo", args: ["-n", "yum", "install", "-y", packages.yum] };
    if (packages.pacman && await findAvailableCommand(["pacman"])) return isRoot ? { command: "pacman", args: ["-S", "--noconfirm", packages.pacman] } : { command: "sudo", args: ["-n", "pacman", "-S", "--noconfirm", packages.pacman] };
  }
  writeDependencyLog("install-command:build:missing", { label: spec.label, platform: process.platform });
  return null;
}

async function ensureSelectedDependencies(dependencies = {}) {
  const selected = Object.entries(dependencySpecs).filter(([key]) => dependencies?.[key] === true);
  const results = [];
  for (const [key, spec] of selected) {
    writeDependencyLog("ensure:start", { key, label: spec.label });
    sendStatus({ phase: "dependency", message: `Checking ${spec.label}...` });
    let installed = false;
    try {
      writeDependencyLog("check:start", { key, label: spec.label, timeoutMs: desktopDependencyTimeouts.checkMs });
      installed = await withTimeout(
        isDependencyInstalled(spec),
        desktopDependencyTimeouts.checkMs,
        `dependency check ${spec.label}`,
      );
      writeDependencyLog("check:finish", { key, label: spec.label, installed });
    } catch (error) {
      writeDependencyLog("check:error", { key, label: spec.label, error });
      sendStatus({ phase: "dependency", message: `${spec.label} check timed out or failed. Continuing with installer lookup...` });
    }
    if (installed) {
      writeDependencyLog("ensure:installed", { key, label: spec.label });
      sendStatus({ phase: "dependency", message: `${spec.label} is already installed. Skipping.` });
      results.push({ key, ok: true, skipped: true });
      continue;
    }
    writeDependencyLog("missing:start", { key, label: spec.label, platform: process.platform });
    sendStatus({ phase: "dependency", message: `${spec.label} is not installed. Looking for an installer...` });
    writeDependencyLog("install-command:start", { key, label: spec.label, timeoutMs: desktopDependencyTimeouts.installCommandMs });
    const installCommand = await withTimeout(
      buildDependencyInstallCommand(spec),
      desktopDependencyTimeouts.installCommandMs,
      `dependency installer lookup ${spec.label}`,
    );
    writeDependencyLog("install-command:finish", { key, label: spec.label, command: installCommand ? [installCommand.command, ...(installCommand.args || [])].join(" ") : "" });
    if (!installCommand) {
      if (process.platform === "darwin" && key === "libreoffice") {
        writeDependencyLog("dmg:install:start", { key, label: spec.label });
        try {
          await installLibreOfficeFromDmg(spec);
          writeDependencyLog("dmg:install:finish", { key, label: spec.label });
          sendStatus({ phase: "dependency", message: `${spec.label} DMG installer finished. Verifying availability...` });
          writeDependencyLog("verify:start", { key, label: spec.label, method: "dmg" });
          if (!(await waitForDependencyInstalled(spec))) {
            writeDependencyLog("verify:failed", { key, label: spec.label, method: "dmg" });
            throw createDependencyError(`${spec.label} DMG installation finished, but it is not available yet. Please restart Noobot or install it manually if /Applications/LibreOffice.app is still missing.`, { failureKind: "verification" });
          }
          writeDependencyLog("verify:finish", { key, label: spec.label, method: "dmg" });
          sendStatus({ phase: "dependency", message: `${spec.label} installed.` });
          results.push({ key, ok: true, installed: true, method: "dmg" });
          continue;
        } catch (error) {
          const meta = getDependencyErrorMeta(error);
          const message = `Failed to auto-install ${spec.label} without Homebrew. ${error?.message || String(error)}`;
          writeDependencyLog("dmg:install:error", { key, label: spec.label, error });
          sendStatus({ phase: "dependency-missing", message, dependency: key, retryable: meta.retryable, failureKind: meta.failureKind });
          throw createDependencyError(message, meta);
        }
      }
      if (process.platform === "darwin" && (key === "ffmpeg" || key === "nodejs")) {
        writeDependencyLog("managed:install:start", { key, label: spec.label });
        try {
          await installManagedDependencyMac(key, spec);
          writeDependencyLog("managed:install:finish", { key, label: spec.label });
          sendStatus({ phase: "dependency", message: `${spec.label} managed installer finished. Verifying availability...` });
          writeDependencyLog("verify:start", { key, label: spec.label, method: "managed" });
          if (!(await waitForDependencyInstalled(spec))) {
            writeDependencyLog("verify:failed", { key, label: spec.label, method: "managed" });
            throw createDependencyError(`${spec.label} managed installation finished, but it is not available yet. Please restart Noobot or install it manually.`, { failureKind: "verification" });
          }
          writeDependencyLog("verify:finish", { key, label: spec.label, method: "managed" });
          sendStatus({ phase: "dependency", message: `${spec.label} installed.` });
          results.push({ key, ok: true, installed: true, method: "managed" });
          continue;
        } catch (error) {
          const meta = getDependencyErrorMeta(error);
          const envHint = key === "ffmpeg" ? "NOOBOT_FFMPEG_MAC_URL" : "NOOBOT_NODEJS_MAC_URL / NOOBOT_NODEJS_MAC_VERSION";
          const message = `Failed to auto-install ${spec.label} without Homebrew. ${error?.message || String(error)} You can override the download with ${envHint}.`;
          writeDependencyLog("managed:install:error", { key, label: spec.label, error });
          sendStatus({ phase: "dependency-missing", message, dependency: key, retryable: meta.retryable, failureKind: meta.failureKind });
          throw createDependencyError(message, meta);
        }
      }
      const message = process.platform === "darwin"
        ? `Cannot auto-install ${spec.label}: Homebrew was not found. Please install ${spec.label} manually or install Homebrew and run: brew install --cask ${spec.packages?.darwin?.brew || spec.packages?.darwin?.brew || spec.label}`
        : `Cannot auto-install ${spec.label}: no supported package manager was found.`;
      writeDependencyLog("missing:no-installer", { key, label: spec.label, message });
      sendStatus({ phase: "dependency-missing", message, dependency: key, retryable: false, failureKind: "installer-unavailable" });
      throw createDependencyError(message, { failureKind: "installer-unavailable" });
    }
    writeDependencyLog("install:start", { key, label: spec.label, command: [installCommand.command, ...(installCommand.args || [])].join(" "), timeoutMs: desktopDependencyTimeouts.installMs });
    sendStatus({ phase: "dependency", message: `Installing ${spec.label}...` });
    const result = await runProcess(installCommand.command, installCommand.args, {
      timeoutMs: desktopDependencyTimeouts.installMs,
    });
    writeDependencyLog("install:finish", { key, label: spec.label, ok: result.ok, code: result.code, error: result.error });
    if (!result.ok) {
      const detail = String(result.stderr || result.stdout || result.error || "").trim().slice(0, 1000);
      throw createDependencyError(`Failed to install ${spec.label}.${detail ? ` ${detail}` : ""}`, { failureKind: "installer" });
    }
    sendStatus({ phase: "dependency", message: `${spec.label} installer finished. Verifying availability...` });
    writeDependencyLog("verify:start", { key, label: spec.label });
    if (!(await waitForDependencyInstalled(spec))) {
      writeDependencyLog("verify:failed", { key, label: spec.label });
      throw createDependencyError(`${spec.label} installation finished, but it is not available yet. Please restart Noobot or install it manually if the command is still missing from PATH.`, { failureKind: "verification" });
    }
    writeDependencyLog("verify:finish", { key, label: spec.label });
    sendStatus({ phase: "dependency", message: `${spec.label} installed.` });
    results.push({ key, ok: true, installed: true });
  }
  return results;
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


function getNestedObject(root, segments) {
  let node = root;
  for (const segment of segments) node = isPlainObject(node) ? node[segment] : undefined;
  return isPlainObject(node) ? node : null;
}

function collectModelOptionsFromConfig(payload = {}) {
  const providers = isPlainObject(payload.providers) ? payload.providers : {};
  return Object.entries(providers)
    .map(([key, value]) => ({
      key: String(key || "").trim(),
      model: String(value?.model || "").trim(),
      description: String(value?.description || "").trim(),
      enabled: value?.enabled !== false,
      usedForConversation: value?.used_for_conversation !== false,
    }))
    .filter((item) => item.key)
    .sort((a, b) => a.key.localeCompare(b.key));
}

function getDefaultModelAlias(payload = {}) {
  const defaultProvider = getNestedString(payload, ["default_provider"]);
  if (defaultProvider) return defaultProvider;
  const providers = isPlainObject(payload.providers) ? payload.providers : {};
  return Object.keys(providers)[0] || "";
}

function setObjectStringValues(target, value) {
  if (!isPlainObject(target)) return;
  for (const key of Object.keys(target)) target[key] = value;
}

function applySelectedModelToConfig(payload = {}, selectedModel = "") {
  const alias = String(selectedModel || "").trim();
  if (!alias || !isPlainObject(payload)) return payload;
  const providers = isPlainObject(payload.providers) ? payload.providers : {};
  if (!isPlainObject(providers[alias])) throw new Error(`Selected model provider not found: ${alias}`);

  payload.default_provider = alias;
  for (const [providerKey, provider] of Object.entries(providers)) {
    if (!isPlainObject(provider)) continue;
    if (providerKey === alias) {
      provider.enabled = true;
      provider.used_for_conversation = true;
    }
  }

  const attachmentModels = getNestedObject(payload, ["attachments", "attachment_models"]);
  setObjectStringValues(attachmentModels, alias);

  const scenarioDefinitions = getNestedObject(payload, ["scenarios", "definitions"]);
  if (scenarioDefinitions) {
    for (const definition of Object.values(scenarioDefinitions)) {
      if (isPlainObject(definition) && Object.prototype.hasOwnProperty.call(definition, "model")) definition.model = alias;
    }
  }

  const webSearchResponses = getNestedObject(payload, ["tools", "web_search", "responses_api"]);
  if (webSearchResponses) webSearchResponses.model = alias;

  const requestHelp = getNestedObject(payload, ["tools", "request_help"]);
  if (requestHelp && Object.prototype.hasOwnProperty.call(requestHelp, "help_model") && String(requestHelp.help_model || "").trim()) requestHelp.help_model = alias;

  const harnessStepModels = getNestedObject(payload, ["plugins", "harness", "stepModels"]);
  setObjectStringValues(harnessStepModels, alias);
  const capabilityModels = getNestedObject(payload, ["plugins", "harness", "capabilityModelByPurpose"]);
  setObjectStringValues(capabilityModels, alias);

  const workflow = getNestedObject(payload, ["plugins", "workflow"]);
  if (workflow && Object.prototype.hasOwnProperty.call(workflow, "semanticModel")) workflow.semanticModel = alias;

  return payload;
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
  const model = getDefaultModelAlias(payload);
  const modelOptions = collectModelOptionsFromConfig(payload);
  const missing = !userId || !connectCode || userId === "admin" || connectCode === "change-your-connect-code";
  return { missing, userId: userId === "admin" ? "" : userId, connectCode: connectCode === "change-your-connect-code" ? "" : connectCode, language, model, modelOptions };
}

function normalizeDesktopLanguage(language) {
  const value = String(language ?? "").trim();
  if (["zh-CN", "en-US"].includes(value)) return value;
  if (value.toLowerCase().startsWith("en")) return "en-US";
  return "zh-CN";
}

function saveSuperAdminConfig({ globalConfigPath, userConfigPath, userId, connectCode, language, model } = {}) {
  const normalizedUserId = String(userId ?? "").trim();
  const normalizedConnectCode = String(connectCode ?? "").trim();
  const normalizedLanguage = normalizeDesktopLanguage(language);
  const normalizedModel = String(model ?? "").trim();
  if (!normalizedUserId) throw new Error("Super admin username is required.");
  if (!normalizedConnectCode) throw new Error("Super admin connect code is required.");
  if (normalizedUserId === "admin") throw new Error("Please change the default super admin username.");
  if (normalizedConnectCode === "change-your-connect-code") throw new Error("Please change the default connect code.");
  const payload = readJsonFile(globalConfigPath, {}) || {};
  setNestedValue(payload, ["super_admin", "user_id"], normalizedUserId);
  setNestedValue(payload, ["super_admin", "connect_code"], normalizedConnectCode);
  setNestedValue(payload, ["preferences", "language"], normalizedLanguage);
  if (normalizedModel) applySelectedModelToConfig(payload, normalizedModel);
  writeJsonFile(globalConfigPath, payload);

  if (userConfigPath) {
    const userPayload = readJsonFile(userConfigPath, null);
    if (isPlainObject(userPayload) && normalizedModel) {
      applySelectedModelToConfig(userPayload, normalizedModel);
      writeJsonFile(userConfigPath, userPayload);
    }
  }
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
    templateConfigPath,
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

ipcMain.handle("noobot:save-super-admin", async (_event, values = {}) => {
  const state = desktopConfigState || ensureDesktopGlobalConfig({ isPackaged: app.isPackaged, userDataPath: app.getPath("userData") });
  saveSuperAdminConfig({ globalConfigPath: state.globalConfigPath, userConfigPath: state.templateConfigPath, userId: values.userId, connectCode: values.connectCode, language: values.language, model: values.model });
  const dependencyResults = await ensureSelectedDependencies(values.dependencies || {});
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
  return { ok: true, dependencies: dependencyResults };
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
