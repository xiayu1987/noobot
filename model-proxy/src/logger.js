/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import path from "node:path";
import { pad } from "./common.js";
import { sanitizeHeaders, sanitizeUrl } from "@noobot/sanitize";
import { formatModelRequestBodyCompleteness } from "@noobot/model-protocol/protocol";
import { text } from "@noobot/shared/value";

function formatCacheDiagnostics(cacheDiagnostics) {
  return cacheDiagnostics ? JSON.stringify(cacheDiagnostics, null, 2) : "[none]";
}

function formatDateForFile(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function createSessionLogDirectoryResolver({
  logDir,
  unknownModelName,
  unknownFlowName,
  unknownSessionId,
}) {
  function sanitizePathSegment(value = "", fallback = "") {
    const normalizedValue = text(value);
    if (!normalizedValue) return fallback;

    return (
      normalizedValue
        .replace(/[\\/]+/g, "_")
        .replace(/[^a-zA-Z0-9._-]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 160) || fallback
    );
  }

  function getModelFlowLogDir(modelName = "", flowName = "") {
    return path.join(
      logDir,
      sanitizePathSegment(modelName, unknownModelName),
      sanitizePathSegment(flowName, unknownFlowName),
    );
  }

  function getModelFlowSessionLogDir(
    modelName = "",
    flowName = "",
    sessionId = "",
    parentSessionId = "",
  ) {
    const modelFlowDir = getModelFlowLogDir(modelName, flowName);
    const safeSessionId = sanitizePathSegment(sessionId, unknownSessionId);
    const safeParentSessionId = sanitizePathSegment(parentSessionId, unknownSessionId);
    const hasParent = text(parentSessionId).length > 0;

    return hasParent
      ? path.join(modelFlowDir, safeParentSessionId, "children", safeSessionId)
      : path.join(modelFlowDir, safeSessionId);
  }
  return getModelFlowSessionLogDir;
}

function createLogWriter({ logDir, logPrefix, maxLogFileSizeBytes, retainMs }) {
  let lastCleanupAt = 0;
  let pendingWrites = Promise.resolve();
  let writeFailure;
  const activeFiles = new Map();
  const logFilePattern = new RegExp(
    `^${RegExp.escape(logPrefix)}-(\\d{4}-\\d{2}-\\d{2})-(\\d{3,})\\.log$`,
  );

  async function cleanupOldLogsInDir(dirPath, now) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const filePath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await cleanupOldLogsInDir(filePath, now);
        await removeEmptyLogDirectory(filePath);
        continue;
      }
      if (!logFilePattern.test(entry.name)) continue;
      let stat;
      try {
        stat = await fs.lstat(filePath);
      } catch (error) {
        console.warn("Unable to inspect model proxy log entry:", filePath, error);
        continue;
      }

      await removeExpiredLogFile(filePath, stat, now);
    }
  }

  async function removeEmptyLogDirectory(filePath) {
    try {
      if (!(await fs.readdir(filePath)).length) await fs.rmdir(filePath);
    } catch (error) {
      console.warn("Unable to remove empty model proxy log directory:", filePath, error);
    }
  }

  async function removeExpiredLogFile(filePath, stat, now) {
    if (now - stat.mtimeMs <= retainMs) return;
    try {
      await fs.unlink(filePath);
    } catch (error) {
      console.warn("Unable to remove expired model proxy log:", filePath, error);
    }
  }

  async function cleanupOldLogs(now) {
    if (now - lastCleanupAt < 60 * 1000) return;
    await fs.mkdir(logDir, { recursive: true });
    await cleanupOldLogsInDir(logDir, now);
    activeFiles.clear();
    lastCleanupAt = now;
  }

  function logFilePath(dir, date, index) {
    return path.join(dir, `${logPrefix}-${date}-${pad(index, 3)}.log`);
  }

  async function readActiveFile(dir, date) {
    const active = activeFiles.get(dir);
    if (active?.date === date) return active;
    await fs.mkdir(dir, { recursive: true });
    let index = 0;
    for (const name of await fs.readdir(dir)) {
      const match = logFilePattern.exec(name);
      if (match?.[1] === date) index = Math.max(index, Number(match[2]));
    }
    const size = index ? (await fs.stat(logFilePath(dir, date, index))).size : 0;
    return { date, index: index || 1, size };
  }

  async function writeLog(dir, date, entry) {
    await cleanupOldLogs(Date.now());
    const active = await readActiveFile(dir, date);
    const bytes = Buffer.byteLength(entry, "utf8");
    const rotate = active.size > 0 && active.size + bytes > maxLogFileSizeBytes;
    const index = active.index + Number(rotate);
    await fs.appendFile(logFilePath(dir, date, index), entry);
    activeFiles.set(dir, { date, index, size: (rotate ? 0 : active.size) + bytes });
  }

  function append(dir, logEntry) {
    const date = formatDateForFile();
    pendingWrites = pendingWrites
      .then(() => writeLog(dir, date, logEntry))
      .catch((error) => {
        activeFiles.delete(dir);
        writeFailure ??= error;
        console.error("Error writing model proxy log:", error);
      });
  }

  async function flush() {
    await pendingWrites;
    if (writeFailure) throw writeFailure;
  }
  return { append, flush };
}

function createLogger(options = {}) {
  const { unknownModelName, unknownFlowName, unknownSessionId } = options;
  const getSessionLogDirectory = createSessionLogDirectoryResolver(options);
  const { append, flush } = createLogWriter(options);

  function logRequest({
    req,
    requestId,
    bodyText = "",
    modelName = unknownModelName,
    flowName = unknownFlowName,
    sessionId = unknownSessionId,
    parentSessionId = "",
    bodyComplete = true,
    cacheDiagnostics = null,
  } = {}) {
    const logEntry = `
=== ${new Date().toLocaleString()} ===
[Request]
RequestId: ${requestId}
Model: ${modelName}
Flow: ${flowName}
SessionId: ${sessionId}
ParentSessionId: ${parentSessionId || "[root]"}
URL: ${sanitizeUrl(req.url)}
Method: ${req.method}
Headers: ${JSON.stringify(sanitizeHeaders(req.headers), null, 2)}
CacheDiagnostics: ${formatCacheDiagnostics(cacheDiagnostics)}
${formatModelRequestBodyCompleteness(bodyComplete)}
Body:
${bodyText}
========================
`;
    append(getSessionLogDirectory(modelName, flowName, sessionId, parentSessionId), logEntry);
  }

  function logTerminal({
    requestId,
    outcome = "error",
    status,
    headers = {},
    bodyText = "",
    error = null,
    modelName = unknownModelName,
    flowName = unknownFlowName,
    sessionId = unknownSessionId,
    parentSessionId = "",
    cacheDiagnostics = null,
  } = {}) {
    const logEntry = `
--- ${new Date().toLocaleString()} ---
[Terminal]
RequestId: ${requestId}
Outcome: ${text(outcome) || "error"}
Model: ${modelName}
Flow: ${flowName}
SessionId: ${sessionId}
ParentSessionId: ${parentSessionId || "[root]"}
Status: ${Number.isFinite(Number(status)) ? Number(status) : "[none]"}
Headers: ${JSON.stringify(sanitizeHeaders(headers), null, 2)}
CacheDiagnostics: ${formatCacheDiagnostics(cacheDiagnostics)}
Error: ${error ? JSON.stringify(error, null, 2) : "[none]"}
Body:
${bodyText}
----------------
`;
    append(getSessionLogDirectory(modelName, flowName, sessionId, parentSessionId), logEntry);
  }

  return {
    flush,
    logRequest,
    logTerminal,
  };
}

export { createLogger, sanitizeHeaders, sanitizeUrl };
