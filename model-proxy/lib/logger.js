/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const fs = require('fs');
const path = require('path');
const { pad, tryParseJson } = require('./common');
const { normalizeUsageCacheDiagnostics } = require('./cache-diagnostics');

const REDACTED_VALUE = '[REDACTED]';
const SENSITIVE_HEADER_PATTERN = /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|apikey|x-auth-token|x-access-token)$/i;
const SENSITIVE_QUERY_PATTERN = /^(?:authorization|cookie|api[-_]?key|apikey|access[-_]?token|auth[-_]?token|token|secret)$/i;

function sanitizeHeaders(headers = {}) {
  if (!headers || typeof headers !== 'object') return {};
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      SENSITIVE_HEADER_PATTERN.test(String(key || '').trim()) ? REDACTED_VALUE : value,
    ]),
  );
}

function sanitizeUrl(rawUrl = '') {
  const value = String(rawUrl || '');
  if (!value || !value.includes('?')) return value;
  try {
    const parsed = new URL(value, 'http://model-proxy.local');
    for (const key of parsed.searchParams.keys()) {
      if (SENSITIVE_QUERY_PATTERN.test(key)) parsed.searchParams.set(key, REDACTED_VALUE);
    }
    return value.startsWith('http://') || value.startsWith('https://')
      ? parsed.toString()
      : `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch (_) {
    return value.replace(
      /([?&](?:authorization|cookie|api[-_]?key|apikey|access[-_]?token|auth[-_]?token|token|secret)=)[^&#]*/gi,
      `$1${REDACTED_VALUE}`,
    );
  }
}

function createLogger({
  logDir,
  logPrefix,
  unknownModelName,
  unknownFlowName,
  unknownSessionId,
  maxLogFileSizeBytes,
  retainMs,
} = {}) {
  let lastCleanupAt = 0;

  function formatDateForFile(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function ensureLogDir() {
    fs.mkdirSync(logDir, { recursive: true });
  }

  function sanitizePathSegment(value = '', fallback = '') {
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue) return fallback;

    return normalizedValue
      .replace(/[\\/]+/g, '_')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 160) || fallback;
  }

  function getModelFlowLogDir(modelName = '', flowName = '') {
    return path.join(
      logDir,
      sanitizePathSegment(modelName, unknownModelName),
      sanitizePathSegment(flowName, unknownFlowName),
    );
  }

  function getModelFlowSessionLogDir(
    modelName = '',
    flowName = '',
    sessionId = '',
    parentSessionId = '',
  ) {
    const modelFlowDir = getModelFlowLogDir(modelName, flowName);
    const safeSessionId = sanitizePathSegment(sessionId, unknownSessionId);
    const safeParentSessionId = sanitizePathSegment(parentSessionId, unknownSessionId);
    const hasParent = String(parentSessionId || '').trim().length > 0;

    return hasParent
      ? path.join(modelFlowDir, safeParentSessionId, 'children', safeSessionId)
      : path.join(modelFlowDir, safeSessionId);
  }

  function ensureModelFlowSessionLogDir(
    modelName = '',
    flowName = '',
    sessionId = '',
    parentSessionId = '',
  ) {
    const modelFlowSessionLogDir = getModelFlowSessionLogDir(
      modelName,
      flowName,
      sessionId,
      parentSessionId,
    );
    fs.mkdirSync(modelFlowSessionLogDir, { recursive: true });
    return modelFlowSessionLogDir;
  }

  function isManagedLogFile(fileName = '') {
    return new RegExp(`^${logPrefix}-\\d{4}-\\d{2}-\\d{2}-\\d{3}\\.log$`).test(fileName);
  }

  function cleanupOldLogsInDir(dirPath, now) {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      let stat = null;
      try {
        stat = fs.statSync(filePath);
      } catch (_) {
        continue;
      }

      if (stat.isDirectory()) {
        cleanupOldLogsInDir(filePath, now);
        try {
          if (!fs.readdirSync(filePath).length) fs.rmdirSync(filePath);
        } catch (_) {
          // ignore
        }
        continue;
      }

      if (!isManagedLogFile(file)) continue;
      try {
        if (now - stat.mtimeMs > retainMs) fs.unlinkSync(filePath);
      } catch (_) {
        // ignore
      }
    }
  }

  function cleanupOldLogs(now = Date.now()) {
    if (now - lastCleanupAt < 60 * 1000) return;
    lastCleanupAt = now;
    cleanupOldLogsInDir(logDir, now);
  }

  function getWritableLogFilePath(
    entrySizeBytes,
    modelName = '',
    flowName = '',
    sessionId = '',
    parentSessionId = '',
  ) {
    const modelFlowSessionLogDir = ensureModelFlowSessionLogDir(
      modelName,
      flowName,
      sessionId,
      parentSessionId,
    );
    const dateStr = formatDateForFile(new Date());
    const regex = new RegExp(`^${logPrefix}-${dateStr}-(\\d{3})\\.log$`);
    const files = fs.readdirSync(modelFlowSessionLogDir);

    const indices = files
      .map((fileName) => {
        const matchResult = fileName.match(regex);
        return matchResult ? Number(matchResult[1]) : null;
      })
      .filter((indexNumber) => Number.isInteger(indexNumber))
      .sort((leftIndex, rightIndex) => leftIndex - rightIndex);

    let index = indices.length ? indices[indices.length - 1] : 1;
    let filePath = path.join(modelFlowSessionLogDir, `${logPrefix}-${dateStr}-${pad(index, 3)}.log`);

    try {
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        if (stat.size + entrySizeBytes > maxLogFileSizeBytes) {
          index += 1;
          filePath = path.join(modelFlowSessionLogDir, `${logPrefix}-${dateStr}-${pad(index, 3)}.log`);
        }
      }
    } catch (_) {
      // ignore
    }

    return filePath;
  }

  function appendLog(
    logEntry,
    modelName = unknownModelName,
    flowName = unknownFlowName,
    sessionId = unknownSessionId,
    parentSessionId = '',
  ) {
    try {
      ensureLogDir();
      cleanupOldLogs(Date.now());

      const bytes = Buffer.byteLength(logEntry, 'utf8');
      const filePath = getWritableLogFilePath(
        bytes,
        modelName,
        flowName,
        sessionId,
        parentSessionId,
      );
      fs.appendFile(filePath, logEntry, (err) => {
        if (err) console.error('Error writing log:', err);
      });
    } catch (err) {
      console.error('Logger error:', err);
    }
  }

  function logRequest({
    req,
    bodyText = '',
    modelName = unknownModelName,
    flowName = unknownFlowName,
    sessionId = unknownSessionId,
    parentSessionId = '',
    cacheDiagnostics = {},
  } = {}) {
    const logEntry = `
=== ${new Date().toLocaleString()} ===
[Request]
Model: ${modelName}
Flow: ${flowName}
SessionId: ${sessionId}
ParentSessionId: ${parentSessionId || '[root]'}
URL: ${sanitizeUrl(req.url)}
Method: ${req.method}
Headers: ${JSON.stringify(sanitizeHeaders(req.headers), null, 2)}
CacheDiagnostics: ${JSON.stringify(cacheDiagnostics, null, 2)}
Body:
${bodyText}
========================
`;
    appendLog(logEntry, modelName, flowName, sessionId, parentSessionId);
  }

  function logResponse({
    proxyRes,
    bodyText = '',
    rawBodyText = bodyText,
    modelName = unknownModelName,
    flowName = unknownFlowName,
    sessionId = unknownSessionId,
    parentSessionId = '',
  } = {}) {
    const responseObject = tryParseJson(rawBodyText);
    const cacheDiagnostics = normalizeUsageCacheDiagnostics(responseObject);
    const logEntry = `
--- ${new Date().toLocaleString()} ---
[Response]
Model: ${modelName}
Flow: ${flowName}
SessionId: ${sessionId}
ParentSessionId: ${parentSessionId || '[root]'}
Status: ${proxyRes.statusCode}
Headers: ${JSON.stringify(sanitizeHeaders(proxyRes.headers), null, 2)}
CacheDiagnostics: ${JSON.stringify(cacheDiagnostics, null, 2)}
Body:
${bodyText}
----------------
`;
    appendLog(logEntry, modelName, flowName, sessionId, parentSessionId);
  }

  ensureLogDir();

  return {
    appendLog,
    logRequest,
    logResponse,
  };
}

module.exports = {
  createLogger,
  sanitizeHeaders,
  sanitizeUrl,
};
