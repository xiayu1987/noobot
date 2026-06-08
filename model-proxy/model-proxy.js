/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const http = require('http');
const httpProxy = require('http-proxy');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const util = require('util');

const gunzip = util.promisify(zlib.gunzip);
const inflate = util.promisify(zlib.inflate);
const brotliDecompress = util.promisify(zlib.brotliDecompress);

const CONFIG_FILE_PATH = path.join(__dirname, 'model-proxy.config.json');

const DEFAULT_CONFIG = {
  proxyHost: '0.0.0.0',
  proxies: [
    {
      localPort: 12341,
      targetUrl: 'https://dashscope.aliyuncs.com',
    },
    {
      localPort: 12342,
      targetUrl: 'https://api.poe.com',
    },
  ],
  logDir: 'logs',
  logPrefix: 'requests',
  unknownModelName: 'unknown_model',
  unknownFlowName: 'unknown_flow',
  unknownSessionId: 'unknown_session',
  modelNameHeaderKey: 'x-model-name',
  harnessFlowHeaderKey: 'x-harness-flow',
  sessionIdHeaderKey: 'x-harness-session-id',
  maxLogFileSizeBytes: 10 * 1024 * 1024,
  retainMs: 60 * 60 * 1000,
};

function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE_PATH)) return { ...DEFAULT_CONFIG };
    const raw = fs.readFileSync(CONFIG_FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_CONFIG,
      ...(parsed && typeof parsed === 'object' ? parsed : {}),
    };
  } catch (error) {
    console.error('[model-proxy] Failed to load config, fallback to defaults:', error);
    return { ...DEFAULT_CONFIG };
  }
}

function normalizeProxyEntries(rawEntries = []) {
  if (!Array.isArray(rawEntries) || !rawEntries.length) {
    return [...DEFAULT_CONFIG.proxies];
  }

  const usedPorts = new Set();
  const normalized = [];

  for (let index = 0; index < rawEntries.length; index += 1) {
    const item = rawEntries[index] || {};
    const rawTarget = String(item.targetUrl || '').trim();
    if (!rawTarget) continue;

    let localPort = Number(item.localPort);
    if (!Number.isInteger(localPort) || localPort <= 0 || localPort > 65535) {
      localPort = DEFAULT_CONFIG.proxies[0].localPort + index;
    }

    if (usedPorts.has(localPort)) {
      console.error(`[model-proxy] Duplicate localPort in config: ${localPort}, skip target ${rawTarget}`);
      continue;
    }

    usedPorts.add(localPort);
    normalized.push({
      targetUrl: rawTarget,
      localPort,
    });
  }

  return normalized.length ? normalized : [...DEFAULT_CONFIG.proxies];
}

const config = loadConfig();
const PROXY_HOST = String(config.proxyHost || DEFAULT_CONFIG.proxyHost).trim() || DEFAULT_CONFIG.proxyHost;
const PROXY_ENTRIES = normalizeProxyEntries(config.proxies);
const LOG_DIR = path.resolve(__dirname, String(config.logDir || DEFAULT_CONFIG.logDir));
const LOG_PREFIX = String(config.logPrefix || DEFAULT_CONFIG.logPrefix);
const UNKNOWN_MODEL_NAME = String(config.unknownModelName || DEFAULT_CONFIG.unknownModelName);
const UNKNOWN_FLOW_NAME = String(config.unknownFlowName || DEFAULT_CONFIG.unknownFlowName);
const UNKNOWN_SESSION_ID = String(config.unknownSessionId || DEFAULT_CONFIG.unknownSessionId);
const MODEL_NAME_HEADER_KEY = String(config.modelNameHeaderKey || DEFAULT_CONFIG.modelNameHeaderKey).toLowerCase();
const HARNESS_FLOW_HEADER_KEY = String(config.harnessFlowHeaderKey || DEFAULT_CONFIG.harnessFlowHeaderKey).toLowerCase();
const SESSION_ID_HEADER_KEY = String(config.sessionIdHeaderKey || DEFAULT_CONFIG.sessionIdHeaderKey).toLowerCase();
const MAX_LOG_FILE_SIZE = Number(config.maxLogFileSizeBytes) > 0
  ? Number(config.maxLogFileSizeBytes)
  : DEFAULT_CONFIG.maxLogFileSizeBytes;
const RETAIN_MS = Number(config.retainMs) > 0 ? Number(config.retainMs) : DEFAULT_CONFIG.retainMs;

let lastCleanupAt = 0;

function pad(numberValue, lengthValue = 2) {
  return String(numberValue).padStart(lengthValue, '0');
}

function formatDateForFile(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function sanitizeModelName(modelName = '') {
  const normalizedModelName = String(modelName || '').trim();
  if (!normalizedModelName) return UNKNOWN_MODEL_NAME;

  return normalizedModelName
    .replace(/[\\/]+/g, '_')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || UNKNOWN_MODEL_NAME;
}

function sanitizeFlowName(flowName = '') {
  const normalizedFlowName = String(flowName || '').trim();
  if (!normalizedFlowName) return UNKNOWN_FLOW_NAME;

  return normalizedFlowName
    .replace(/[\\/]+/g, '_')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || UNKNOWN_FLOW_NAME;
}

function getModelFlowLogDir(modelName = '', flowName = '') {
  return path.join(LOG_DIR, sanitizeModelName(modelName), sanitizeFlowName(flowName));
}

function sanitizeSessionId(sessionId = '') {
  const normalizedSessionId = String(sessionId || '').trim();
  if (!normalizedSessionId) return UNKNOWN_SESSION_ID;

  return normalizedSessionId
    .replace(/[\\/]+/g, '_')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 160) || UNKNOWN_SESSION_ID;
}

function getModelFlowSessionLogDir(modelName = '', flowName = '', sessionId = '') {
  return path.join(
    getModelFlowLogDir(modelName, flowName),
    sanitizeSessionId(sessionId),
  );
}

function ensureModelFlowSessionLogDir(modelName = '', flowName = '', sessionId = '') {
  const modelFlowSessionLogDir = getModelFlowSessionLogDir(modelName, flowName, sessionId);
  fs.mkdirSync(modelFlowSessionLogDir, { recursive: true });
  return modelFlowSessionLogDir;
}

function isManagedLogFile(fileName = '') {
  return new RegExp(`^${LOG_PREFIX}-\\d{4}-\\d{2}-\\d{2}-\\d{3}\\.log$`).test(fileName);
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
      if (now - stat.mtimeMs > RETAIN_MS) {
        fs.unlinkSync(filePath);
      }
    } catch (_) {
      // ignore
    }
  }
}

function cleanupOldLogs(now = Date.now()) {
  if (now - lastCleanupAt < 60 * 1000) return;
  lastCleanupAt = now;

  cleanupOldLogsInDir(LOG_DIR, now);
}

function getWritableLogFilePath(entrySizeBytes, modelName = '', flowName = '', sessionId = '') {
  const modelFlowSessionLogDir = ensureModelFlowSessionLogDir(modelName, flowName, sessionId);
  const dateStr = formatDateForFile(new Date());
  const regex = new RegExp(`^${LOG_PREFIX}-${dateStr}-(\\d{3})\\.log$`);
  const files = fs.readdirSync(modelFlowSessionLogDir);

  const indices = files
    .map((fileName) => {
      const matchResult = fileName.match(regex);
      return matchResult ? Number(matchResult[1]) : null;
    })
    .filter((indexNumber) => Number.isInteger(indexNumber))
    .sort((leftIndex, rightIndex) => leftIndex - rightIndex);

  let index = indices.length ? indices[indices.length - 1] : 1;
  let filePath = path.join(modelFlowSessionLogDir, `${LOG_PREFIX}-${dateStr}-${pad(index, 3)}.log`);

  try {
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      if (stat.size + entrySizeBytes > MAX_LOG_FILE_SIZE) {
        index += 1;
        filePath = path.join(modelFlowSessionLogDir, `${LOG_PREFIX}-${dateStr}-${pad(index, 3)}.log`);
      }
    }
  } catch (_) {
    // ignore
  }

  return filePath;
}

function appendLog(
  logEntry,
  modelName = UNKNOWN_MODEL_NAME,
  flowName = UNKNOWN_FLOW_NAME,
  sessionId = UNKNOWN_SESSION_ID,
) {
  try {
    ensureLogDir();
    cleanupOldLogs(Date.now());

    const bytes = Buffer.byteLength(logEntry, 'utf8');
    const filePath = getWritableLogFilePath(bytes, modelName, flowName, sessionId);
    fs.appendFile(filePath, logEntry, (err) => {
      if (err) console.error('Error writing log:', err);
    });
  } catch (err) {
    console.error('Logger error:', err);
  }
}

function extractModelNameFromHeaders(headers = {}) {
  if (!headers || typeof headers !== 'object') return '';
  const rawHeaderValue = headers[MODEL_NAME_HEADER_KEY];
  if (Array.isArray(rawHeaderValue)) {
    return String(rawHeaderValue[0] || '').trim();
  }
  return String(rawHeaderValue || '').trim();
}

function extractSessionIdFromHeaders(headers = {}) {
  if (!headers || typeof headers !== 'object') return '';
  const rawHeaderValue = headers[SESSION_ID_HEADER_KEY];
  if (Array.isArray(rawHeaderValue)) {
    return String(rawHeaderValue[0] || '').trim();
  }
  return String(rawHeaderValue || '').trim();
}

function extractHarnessFlowFromHeaders(headers = {}) {
  if (!headers || typeof headers !== 'object') return '';
  const rawHeaderValue = headers[HARNESS_FLOW_HEADER_KEY];
  if (Array.isArray(rawHeaderValue)) {
    return String(rawHeaderValue[0] || '').trim();
  }
  return String(rawHeaderValue || '').trim();
}

function resolveRequestModelName(req) {
  return extractModelNameFromHeaders(req?.headers) || UNKNOWN_MODEL_NAME;
}

function logRequestStream(req) {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  req.on('end', () => {
    const bodyBuffer = Buffer.concat(chunks);
    const bodyText = bodyBuffer.toString('utf8');
    const modelName = resolveRequestModelName(req);
    const harnessFlow = extractHarnessFlowFromHeaders(req?.headers) || UNKNOWN_FLOW_NAME;
    const sessionId = extractSessionIdFromHeaders(req?.headers) || UNKNOWN_SESSION_ID;
    req.__logModelName = modelName;
    req.__logHarnessFlow = harnessFlow;
    req.__logSessionId = sessionId;
    const logEntry = `
=== ${new Date().toLocaleString()} ===
[Request]
Model: ${modelName}
Flow: ${harnessFlow}
SessionId: ${sessionId}
URL: ${req.url}
Method: ${req.method}
Headers: ${JSON.stringify(req.headers, null, 2)}
Body:
${bodyText}
========================
`;
    appendLog(logEntry, modelName, harnessFlow, sessionId);
  });
}

async function decodeBodyByEncoding(buffer, encoding) {
  if (!encoding) return buffer;
  const enc = String(encoding).toLowerCase();

  try {
    if (enc.includes('gzip')) return await gunzip(buffer);
    if (enc.includes('deflate')) return await inflate(buffer);
    if (enc.includes('br')) return await brotliDecompress(buffer);
    return buffer;
  } catch (_) {
    return buffer;
  }
}

function normalizeBodyText(text, contentType = '') {
  const ct = String(contentType).toLowerCase();

  if (ct.includes('application/json')) {
    try {
      const obj = JSON.parse(text);
      return JSON.stringify(obj, null, 2);
    } catch {
      return text;
    }
  }

  return text;
}

function tryParseJson(text = '') {
  try {
    return JSON.parse(String(text || ''));
  } catch {
    return null;
  }
}

function normalizeToolCallItem(toolCallItem = {}) {
  if (!toolCallItem || typeof toolCallItem !== 'object') return null;
  const normalizedFunction = toolCallItem.function && typeof toolCallItem.function === 'object'
    ? {
        name: String(toolCallItem.function.name || '').trim(),
        arguments: String(toolCallItem.function.arguments || ''),
      }
    : {};
  const normalized = {
    id: String(toolCallItem.id || '').trim(),
    type: String(toolCallItem.type || '').trim() || 'function',
    function: normalizedFunction,
  };
  if (!normalized.id && !normalized.function?.name && !normalized.function?.arguments) return null;
  return normalized;
}

function extractToolCallsFromJsonPayload(payloadObject = null) {
  if (!payloadObject || typeof payloadObject !== 'object') return [];
  const choices = Array.isArray(payloadObject?.choices) ? payloadObject.choices : [];
  const firstChoice = choices[0] && typeof choices[0] === 'object' ? choices[0] : null;
  const messageToolCalls = Array.isArray(firstChoice?.message?.tool_calls)
    ? firstChoice.message.tool_calls
    : [];
  if (messageToolCalls.length) {
    return messageToolCalls.map((item) => normalizeToolCallItem(item)).filter(Boolean);
  }
  const deltaToolCalls = Array.isArray(firstChoice?.delta?.tool_calls)
    ? firstChoice.delta.tool_calls
    : [];
  if (deltaToolCalls.length) {
    return deltaToolCalls.map((item) => normalizeToolCallItem(item)).filter(Boolean);
  }
  return [];
}

function extractFinalTextFromJsonPayload(payloadObject = null) {
  if (!payloadObject || typeof payloadObject !== 'object') return '';

  const choices = Array.isArray(payloadObject?.choices) ? payloadObject.choices : [];
  const firstChoice = choices[0] && typeof choices[0] === 'object' ? choices[0] : null;
  const messageContent = String(firstChoice?.message?.content || '').trim();
  if (messageContent) return messageContent;

  const deltaContent = String(firstChoice?.delta?.content || '').trim();
  if (deltaContent) return deltaContent;

  const outputText = payloadObject?.output_text;
  if (typeof outputText === 'string' && outputText.trim()) return outputText.trim();
  if (Array.isArray(outputText)) {
    const joinedOutputText = outputText
      .map((itemValue) => String(itemValue || '').trim())
      .filter(Boolean)
      .join('\n');
    if (joinedOutputText) return joinedOutputText;
  }

  const toolCalls = extractToolCallsFromJsonPayload(payloadObject);
  if (toolCalls.length) {
    return JSON.stringify(
      {
        type: 'tool_calls',
        tool_calls: toolCalls,
      },
      null,
      2,
    );
  }

  return '';
}

function extractFinalTextFromSseBody(sseText = '') {
  const lines = String(sseText || '').split(/\r?\n/);
  const dataPayloads = lines
    .map((lineValue) => String(lineValue || '').trim())
    .filter((lineValue) => lineValue.startsWith('data:'))
    .map((lineValue) => lineValue.slice(5).trim())
    .filter((lineValue) => lineValue && lineValue !== '[DONE]');

  if (!dataPayloads.length) return '';

  let deltaTextBuffer = '';
  let latestResolvedText = '';
  const toolCallBufferByIndex = new Map();

  function upsertToolCallDelta(deltaToolCallItem = {}, fallbackIndex = 0) {
    if (!deltaToolCallItem || typeof deltaToolCallItem !== 'object') return;
    const index = Number.isInteger(deltaToolCallItem.index)
      ? deltaToolCallItem.index
      : fallbackIndex;
    const existed = toolCallBufferByIndex.get(index) || {
      id: '',
      type: 'function',
      function: { name: '', arguments: '' },
    };
    const normalizedType = String(deltaToolCallItem.type || '').trim();
    if (normalizedType) existed.type = normalizedType;
    const normalizedId = String(deltaToolCallItem.id || '').trim();
    if (normalizedId) existed.id = normalizedId;

    const fn = deltaToolCallItem.function && typeof deltaToolCallItem.function === 'object'
      ? deltaToolCallItem.function
      : null;
    if (fn) {
      const namePart = String(fn.name || '');
      if (namePart) existed.function.name = `${existed.function.name || ''}${namePart}`;
      const argsPart = String(fn.arguments || '');
      if (argsPart) existed.function.arguments = `${existed.function.arguments || ''}${argsPart}`;
    }
    toolCallBufferByIndex.set(index, existed);
  }

  for (const payloadText of dataPayloads) {
    const payloadObject = tryParseJson(payloadText);
    if (!payloadObject) {
      latestResolvedText = payloadText;
      continue;
    }
    const payloadResolvedText = extractFinalTextFromJsonPayload(payloadObject);
    if (!payloadResolvedText) continue;

    const payloadChoices = Array.isArray(payloadObject?.choices)
      ? payloadObject.choices
      : [];
    const firstChoice = payloadChoices[0] && typeof payloadChoices[0] === 'object'
      ? payloadChoices[0]
      : null;
    const hasDeltaContent = typeof firstChoice?.delta?.content === 'string';
    if (hasDeltaContent) {
      deltaTextBuffer += String(firstChoice?.delta?.content || '');
      latestResolvedText = deltaTextBuffer;
    } else {
      latestResolvedText = payloadResolvedText;
    }

    const deltaToolCalls = Array.isArray(firstChoice?.delta?.tool_calls)
      ? firstChoice.delta.tool_calls
      : [];
    if (deltaToolCalls.length) {
      deltaToolCalls.forEach((item, idx) => upsertToolCallDelta(item, idx));
      if (!latestResolvedText) latestResolvedText = '[tool_calls_streaming]';
    }
  }

  if (toolCallBufferByIndex.size && !String(latestResolvedText || '').trim()) {
    const toolCalls = Array.from(toolCallBufferByIndex.entries())
      .sort((left, right) => left[0] - right[0])
      .map(([, item]) => normalizeToolCallItem(item))
      .filter(Boolean);
    if (toolCalls.length) {
      return JSON.stringify(
        {
          type: 'tool_calls',
          tool_calls: toolCalls,
        },
        null,
        2,
      );
    }
  }

  return latestResolvedText || dataPayloads[dataPayloads.length - 1];
}

function resolveFinalResponseBodyText(bodyText = '', contentType = '') {
  const normalizedContentType = String(contentType || '').toLowerCase();
  const normalizedBodyText = String(bodyText || '');

  if (normalizedContentType.includes('text/event-stream')) {
    const finalSseText = extractFinalTextFromSseBody(normalizedBodyText);
    return finalSseText || normalizedBodyText;
  }

  if (normalizedContentType.includes('application/json')) {
    const payloadObject = tryParseJson(normalizedBodyText);
    const finalJsonText = extractFinalTextFromJsonPayload(payloadObject);
    if (finalJsonText) return finalJsonText;
    return normalizeBodyText(normalizedBodyText, contentType);
  }

  return normalizedBodyText;
}

function logResponse(
  proxyRes,
  bodyText,
  modelName = UNKNOWN_MODEL_NAME,
  harnessFlow = UNKNOWN_FLOW_NAME,
  sessionId = UNKNOWN_SESSION_ID,
) {
  const logEntry = `
--- ${new Date().toLocaleString()} ---
[Response]
Model: ${modelName}
Flow: ${harnessFlow}
SessionId: ${sessionId}
Status: ${proxyRes.statusCode}
Headers: ${JSON.stringify(proxyRes.headers, null, 2)}
Body:
${bodyText}
----------------
`;
  appendLog(logEntry, modelName, harnessFlow, sessionId);
}

function createProxyServer(localPort, targetUrl) {
  const proxy = httpProxy.createProxyServer({
    target: targetUrl,
    changeOrigin: true,
    secure: false,
  });

  proxy.on('proxyRes', (proxyRes, req) => {
    const chunks = [];

    proxyRes.on('data', (chunk) => {
      chunks.push(Buffer.from(chunk));
    });

    proxyRes.on('end', async () => {
      try {
        const raw = Buffer.concat(chunks);
        const decoded = await decodeBodyByEncoding(raw, proxyRes.headers['content-encoding']);
        const text = decoded.toString('utf8');
        const finalText = resolveFinalResponseBodyText(
          text,
          proxyRes.headers['content-type'],
        );
        const modelName = req.__logModelName || UNKNOWN_MODEL_NAME;
        const harnessFlow = req.__logHarnessFlow || UNKNOWN_FLOW_NAME;
        const sessionId = req.__logSessionId || UNKNOWN_SESSION_ID;
        logResponse(proxyRes, finalText, modelName, harnessFlow, sessionId);
      } catch (error) {
        appendLog(
          `\n[Response Log Error] ${new Date().toLocaleString()} ${error.stack || error}\n`,
          req.__logModelName || UNKNOWN_MODEL_NAME,
          req.__logHarnessFlow || UNKNOWN_FLOW_NAME,
          req.__logSessionId || UNKNOWN_SESSION_ID,
        );
      }
    });
  });

  proxy.on('error', (err, req, res) => {
    console.error(`[model-proxy:${localPort}] Proxy error:`, err);
    if (res && !res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad Gateway');
    } else if (res) {
      res.end();
    }
  });

  const server = http.createServer((req, res) => {
    logRequestStream(req);
    proxy.web(req, res);
  });

  server.listen(localPort, PROXY_HOST, () => {
    console.log(`[model-proxy] Reverse proxy running on http://${PROXY_HOST}:${localPort} -> ${targetUrl}`);
  });

  return server;
}

ensureLogDir();
for (const entry of PROXY_ENTRIES) {
  createProxyServer(entry.localPort, entry.targetUrl);
}
