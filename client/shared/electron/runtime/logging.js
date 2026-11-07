/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import fs from "node:fs";
import os from "node:os";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { clientFilePath as path } from "../../path-resolver.js";
import { createDesktopRuntimeEventWriter } from "./runtime-events.js";

const desktopAppName = "Noobot";

const desktopLogQueues = new Map();

export const DESKTOP_LOG_FILES = Object.freeze({
  STARTUP: "desktop-startup.log",
  MAIN: "desktop-main.log",
  DEPENDENCY: "desktop-dependency.log",
  SERVICE: "service.log",
  AGENT_PROXY: "agent-proxy.log",
  FRONTEND: "frontend.log",
});

async function rotateDesktopLog(filePath, retain, content) {
  await fs.promises.rm(`${filePath}.${retain}`, { force: true });
  for (let index = retain - 1; index >= 1; index -= 1) {
    try {
      await fs.promises.rename(`${filePath}.${index}`, `${filePath}.${index + 1}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  await fs.promises.writeFile(`${filePath}.1`, content);
}

export function appendDesktopLogLine(
  filePath,
  line,
  {
    maxBytes = LENGTH_THRESHOLDS.desktopLogging.maxFileBytes,
    retain = QUANTITY_THRESHOLDS.desktop.logRetainCount,
  } = {},
) {
  const previous = desktopLogQueues.get(filePath) || Promise.resolve();
  const operation = previous
    .catch((error) => {
      console.warn("[desktop-log] previous queued write failed", error);
    })
    .then(async () => {
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      const lineBytes = Buffer.byteLength(line, "utf8");
      const handle = await fs.promises.open(filePath, "a+");
      try {
        const fileStat = await handle.stat();
        if (fileStat.isFile() && fileStat.size > 0 && fileStat.size + lineBytes > maxBytes) {
          const previousContent = Buffer.alloc(fileStat.size);
          await handle.read(previousContent, 0, previousContent.length, 0);
          await rotateDesktopLog(filePath, retain, previousContent);
          await handle.truncate(0);
        }
        await handle.writeFile(line, "utf8");
      } finally {
        await handle.close();
      }
    });
  desktopLogQueues.set(filePath, operation);
  return operation.finally(() => {
    if (desktopLogQueues.get(filePath) === operation) desktopLogQueues.delete(filePath);
  });
}

function getEarlyLogFilePath() {
  const base =
    process.platform === "win32"
      ? process.env.APPDATA || process.env.LOCALAPPDATA || process.env.TEMP || process.cwd()
      : process.env.XDG_CONFIG_HOME || process.env.HOME || process.env.TMPDIR || process.cwd();
  return path.join(base, desktopAppName, "logs", DESKTOP_LOG_FILES.STARTUP);
}

export function appendEarlyLog(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    const logFile = getEarlyLogFilePath();
    appendDesktopLogLine(logFile, line).catch((error) => {
      console.warn("[desktop-log] early log write failed", error);
    });
  } catch (error) {
    console.warn("[desktop-log] early log path resolution failed", error);
  }
}

function appendFallbackDebugLog(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  const candidates = [
    path.join(process.env.HOME || process.cwd(), `${desktopAppName}-startup-debug.log`),
    path.join(os.tmpdir(), `${desktopAppName}-startup-debug.log`),
  ];
  for (const filePath of candidates) {
    try {
      appendDesktopLogLine(filePath, line).catch((error) => {
        console.warn("[desktop-log] startup trace write failed", { filePath, error });
      });
    } catch (error) {
      console.warn("[desktop-log] startup trace scheduling failed", { filePath, error });
    }
  }
}

function appendStartupTrace(message) {
  appendEarlyLog(message);
  appendFallbackDebugLog(message);
}

function formatLogValue(value) {
  if (value === undefined || value === null) return "";
  if (value instanceof Error) return value.stack || value.message || String(value);
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function formatLogFields(fields = {}) {
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${formatLogValue(value).replace(/\s+/g, " ").slice(0, 1200)}`)
    .join("; ");
}

export function createStartupLogger({ app, startupDebugEnabled = false } = {}) {
  const runtimeEvents = createDesktopRuntimeEventWriter({ app });
  const pendingWrites = new Set();
  const writeFailures = [];
  function trackWrite(operation) {
    pendingWrites.add(operation);
    operation.then(
      () => pendingWrites.delete(operation),
      (error) => {
        pendingWrites.delete(operation);
        writeFailures.push(error);
        console.error("[desktop-log] write failed", error);
      },
    );
  }
  async function flush() {
    while (pendingWrites.size) await Promise.allSettled([...pendingWrites]);
    if (writeFailures.length) {
      throw new AggregateError(writeFailures.splice(0), "Desktop log writes failed");
    }
  }

  function getLogDir() {
    return path.join(app.getPath("userData"), "logs");
  }

  function getLogFilePath(fileName = DESKTOP_LOG_FILES.STARTUP) {
    return path.join(getLogDir(), fileName);
  }

  function appendLogFile(fileName, message) {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    const logFile = getLogFilePath(fileName);
    trackWrite(appendDesktopLogLine(logFile, line));
  }

  function writeStartupLog(
    scope,
    event,
    fields = {},
    { debug = false, mirrorToEarly = true } = {},
  ) {
    if (debug && !startupDebugEnabled) return;
    const detail = formatLogFields(fields);
    const message = `[${scope}:${event}]${detail ? ` ${detail}` : ""}`;
    appendLogFile(DESKTOP_LOG_FILES.STARTUP, message);
    trackWrite(
      runtimeEvents.write(
        {
          scope: "startup",
          category: scope === "frontend" ? "frontend-lifecycle" : "backend-lifecycle",
          event: `desktop.${scope}.${event}`,
        },
        fields,
      ),
    );
    if (mirrorToEarly) appendStartupTrace(message);
  }

  function writeDependencyLog(event, fields = {}, options = {}) {
    if (options?.debug && !startupDebugEnabled) return;
    const detail = formatLogFields(fields);
    const message = `[dependency:${event}]${detail ? ` ${detail}` : ""}`;
    appendLogFile(DESKTOP_LOG_FILES.DEPENDENCY, message);
    trackWrite(
      runtimeEvents.write(
        {
          scope: "startup",
          category: "frontend-lifecycle",
          event: `desktop.dependency.${event}`,
        },
        fields,
      ),
    );
    writeStartupLog("dependency", event, fields, { ...options, mirrorToEarly: false });
  }

  function appendDesktopLog(message) {
    appendLogFile(DESKTOP_LOG_FILES.MAIN, message);
  }

  function appendStartupLog(message) {
    appendLogFile(DESKTOP_LOG_FILES.STARTUP, message);
  }

  function appendServiceLog(message) {
    appendLogFile(DESKTOP_LOG_FILES.SERVICE, message);
  }

  function appendAgentProxyLog(message) {
    appendLogFile(DESKTOP_LOG_FILES.AGENT_PROXY, message);
  }

  function appendFrontendLog(message) {
    appendLogFile(DESKTOP_LOG_FILES.FRONTEND, message);
  }

  return {
    writeStartupLog,
    flush,
    writeDependencyLog,
    getLogDir,
    getLogFilePath,
    getRuntimeEventsRoot: () => runtimeEvents.runtimeEventsRoot,
    appendDesktopLog,
    appendStartupLog,
    appendServiceLog,
    appendAgentProxyLog,
    appendFrontendLog,
  };
}

export function installEarlyDiagnostics({ app, moduleUrl, filename, dirname } = {}) {
  if (!app) throw new Error("installEarlyDiagnostics requires app");
  app.setName(desktopAppName);
  const loadMessage = `[main:module] loaded; node=${process.version}; electron=${process.versions.electron}; platform=${process.platform}; packaged=${app.isPackaged}; filename=${filename || moduleUrl || ""}; dirname=${dirname || ""}; execPath=${process.execPath}; resourcesPath=${process.resourcesPath || ""}; argv=${process.argv.join(" ")}`;
  appendEarlyLog(loadMessage);
  appendFallbackDebugLog(loadMessage);

  process.on("uncaughtException", (error) => {
    appendEarlyLog(
      `[process:uncaughtException] ${error?.stack || error?.message || String(error)}`,
    );
  });

  process.on("unhandledRejection", (reason) => {
    appendEarlyLog(
      `[process:unhandledRejection] ${reason?.stack || reason?.message || String(reason)}`,
    );
  });

  app.on("will-finish-launching", () => appendEarlyLog("[app:event] will-finish-launching"));
  app.on("ready", () => appendEarlyLog("[app:event] ready"));
  app.on("browser-window-created", () => appendEarlyLog("[app:event] browser-window-created"));
  app.on("render-process-gone", (_event, _webContents, details) => {
    appendEarlyLog(
      `[app:event] render-process-gone reason=${details?.reason || ""} exitCode=${details?.exitCode ?? ""}`,
    );
  });
  app.on("child-process-gone", (_event, details) => {
    appendEarlyLog(
      `[app:event] child-process-gone type=${details?.type || ""} reason=${details?.reason || ""} exitCode=${details?.exitCode ?? ""}`,
    );
  });
  app.on("gpu-process-crashed", (_event, killed) =>
    appendEarlyLog(`[app:event] gpu-process-crashed killed=${killed}`),
  );

  setTimeout(() => {
    appendEarlyLog(
      `[main:timer] 3000ms after module load; isReady=${app.isReady()}; whenReadyState=pending-or-resolved`,
    );
  }, TIME_THRESHOLDS.desktop.startupProgressReplayDelayMs);
}
