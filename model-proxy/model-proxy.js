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

const LOCAL_PORT = 12341;
const TARGET_URL = 'https://dashscope.aliyuncs.com';
const LOG_DIR = path.join(__dirname, 'logs');
const LOG_PREFIX = 'requests';
const UNKNOWN_MODEL_NAME = 'unknown_model';
const UNKNOWN_FLOW_NAME = 'unknown_flow';
const MODEL_NAME_HEADER_KEY = 'x-model-name';
const HARNESS_FLOW_HEADER_KEY = 'x-harness-flow';
const MAX_LOG_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const RETAIN_MS = 60 * 60 * 1000; // 仅保留最近 1 小时

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

function ensureModelFlowLogDir(modelName = '', flowName = '') {
  const modelFlowLogDir = getModelFlowLogDir(modelName, flowName);
  fs.mkdirSync(modelFlowLogDir, { recursive: true });
  return modelFlowLogDir;
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
      // 忽略单文件异常，避免影响代理主流程
      continue;
    }

    if (stat.isDirectory()) {
      cleanupOldLogsInDir(filePath, now);
      try {
        if (!fs.readdirSync(filePath).length) fs.rmdirSync(filePath);
      } catch (_) {
        // 忽略清理空目录异常
      }
      continue;
    }

    if (!isManagedLogFile(file)) continue;
    try {
      if (now - stat.mtimeMs > RETAIN_MS) {
        fs.unlinkSync(filePath);
      }
    } catch (_) {
      // 忽略单文件异常，避免影响代理主流程
    }
  }
}

function cleanupOldLogs(now = Date.now()) {
  // 降低清理频率：每分钟最多清理一次
  if (now - lastCleanupAt < 60 * 1000) return;
  lastCleanupAt = now;

  cleanupOldLogsInDir(LOG_DIR, now);
}

function getWritableLogFilePath(entrySizeBytes, modelName = '', flowName = '') {
  const modelFlowLogDir = ensureModelFlowLogDir(modelName, flowName);
  const dateStr = formatDateForFile(new Date());
  const regex = new RegExp(`^${LOG_PREFIX}-${dateStr}-(\\d{3})\\.log$`);
  const files = fs.readdirSync(modelFlowLogDir);

  const indices = files
    .map((fileName) => {
      const matchResult = fileName.match(regex);
      return matchResult ? Number(matchResult[1]) : null;
    })
    .filter((indexNumber) => Number.isInteger(indexNumber))
    .sort((leftIndex, rightIndex) => leftIndex - rightIndex);

  let index = indices.length ? indices[indices.length - 1] : 1;
  let filePath = path.join(modelFlowLogDir, `${LOG_PREFIX}-${dateStr}-${pad(index, 3)}.log`);

  try {
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      if (stat.size + entrySizeBytes > MAX_LOG_FILE_SIZE) {
        index += 1;
        filePath = path.join(modelFlowLogDir, `${LOG_PREFIX}-${dateStr}-${pad(index, 3)}.log`);
      }
    }
  } catch (_) {
    // 出错时退回到当前文件，避免影响代理流程
  }

  return filePath;
}

function appendLog(
  logEntry,
  modelName = UNKNOWN_MODEL_NAME,
  flowName = UNKNOWN_FLOW_NAME,
) {
  try {
    ensureLogDir();
    cleanupOldLogs(Date.now());

    const bytes = Buffer.byteLength(logEntry, 'utf8');
    const filePath = getWritableLogFilePath(bytes, modelName, flowName);
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

const proxy = httpProxy.createProxyServer({
  target: TARGET_URL,
  changeOrigin: true,
  secure: false, // 测试用，忽略证书
});

// 记录请求体（注意：大流量/大文件场景不建议这样做）
function logRequestStream(req) {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  req.on('end', () => {
    const bodyBuffer = Buffer.concat(chunks);
    const bodyText = bodyBuffer.toString('utf8');
    const modelName = resolveRequestModelName(req);
    const harnessFlow = extractHarnessFlowFromHeaders(req?.headers) || UNKNOWN_FLOW_NAME;
    req.__logModelName = modelName;
    req.__logHarnessFlow = harnessFlow;
    const logEntry = `
=== ${new Date().toLocaleString()} ===
[Request]
Model: ${modelName}
Flow: ${harnessFlow}
URL: ${req.url}
Method: ${req.method}
Headers: ${JSON.stringify(req.headers, null, 2)}
Body:
${bodyText}
========================
`;
    appendLog(logEntry, modelName, harnessFlow);
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
  } catch (error) {
    // 解压失败就返回原始数据，避免影响代理功能
    return buffer;
  }
}

function normalizeBodyText(text, contentType = '') {
  const ct = String(contentType).toLowerCase();

  // JSON 场景：让 JSON.parse 处理转义字符，比手写 \u 替换安全
  if (ct.includes('application/json')) {
    try {
      const obj = JSON.parse(text);
      return JSON.stringify(obj, null, 2);
    } catch {
      return text;
    }
  }

  // SSE 常见 content-type: text/event-stream
  // 不做额外替换，保持原样
  return text;
}

function tryParseJson(text = '') {
  try {
    return JSON.parse(String(text || ''));
  } catch {
    return null;
  }
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
      continue;
    }
    latestResolvedText = payloadResolvedText;
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
) {
  const logEntry = `
--- ${new Date().toLocaleString()} ---
[Response]
Model: ${modelName}
Flow: ${harnessFlow}
Status: ${proxyRes.statusCode}
Headers: ${JSON.stringify(proxyRes.headers, null, 2)}
Body:
${bodyText}
----------------
`;
  appendLog(logEntry, modelName, harnessFlow);
}

// 在上游响应层面抓包（关键）
proxy.on('proxyRes', (proxyRes, req, res) => {
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
      logResponse(proxyRes, finalText, modelName, harnessFlow);
    } catch (error) {
      appendLog(
        `\n[Response Log Error] ${new Date().toLocaleString()} ${error.stack || error}\n`,
        req.__logModelName || UNKNOWN_MODEL_NAME,
        req.__logHarnessFlow || UNKNOWN_FLOW_NAME,
      );
    }
  });
});

proxy.on('error', (err, req, res) => {
  console.error('Proxy error:', err);
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

server.listen(LOCAL_PORT, '0.0.0.0', () => {
  console.log(`Reverse proxy running on http://localhost:${LOCAL_PORT}`);
});
