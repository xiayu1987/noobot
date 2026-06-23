/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const http = require('http');
const httpProxy = require('http-proxy');
const { getHeaderValue } = require('./common');
const {
  decodeBodyByEncoding,
  resolveFinalResponseBodyText,
} = require('./response-body');

function createHeaderExtractors({
  modelNameHeaderKey,
  parentSessionIdHeaderKey,
  flowHeaderKeys,
  sessionIdHeaderKeys,
  unknownModelName,
  unknownFlowName,
  unknownSessionId,
} = {}) {
  function extractModelNameFromHeaders(headers = {}) {
    return getHeaderValue(headers, [modelNameHeaderKey]) || unknownModelName;
  }

  function extractFlowFromHeaders(headers = {}) {
    return getHeaderValue(headers, flowHeaderKeys) || unknownFlowName;
  }

  function extractSessionIdFromHeaders(headers = {}) {
    return getHeaderValue(headers, sessionIdHeaderKeys) || unknownSessionId;
  }

  function extractParentSessionIdFromHeaders(headers = {}) {
    if (!headers || typeof headers !== 'object') return '';
    const candidates = [
      parentSessionIdHeaderKey,
      'parentsessionid',
      'parent-sessionid',
      'parent-session-id',
      'x-plugin-parent-session-id',
      'x-plugin-parent-sessionid',
      'x-parent-session-id',
      'x-parent-sessionid',
      'x-harness-parent-session-id',
    ];
    return getHeaderValue(headers, candidates);
  }

  return {
    extractFlowFromHeaders,
    extractModelNameFromHeaders,
    extractParentSessionIdFromHeaders,
    extractSessionIdFromHeaders,
  };
}

function createProxyServer({
  localPort,
  targetUrl,
  proxyHost,
  logger,
  buildRequestCacheDiagnostics,
  headerExtractors,
  unknownModelName,
  unknownFlowName,
  unknownSessionId,
} = {}) {
  const proxy = httpProxy.createProxyServer({
    target: targetUrl,
    changeOrigin: true,
    secure: false,
  });

  function logRequestStream(req) {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      const bodyBuffer = Buffer.concat(chunks);
      const bodyText = bodyBuffer.toString('utf8');
      const modelName = headerExtractors.extractModelNameFromHeaders(req?.headers) || unknownModelName;
      const flowName = headerExtractors.extractFlowFromHeaders(req?.headers) || unknownFlowName;
      const sessionId = headerExtractors.extractSessionIdFromHeaders(req?.headers) || unknownSessionId;
      const parentSessionId = headerExtractors.extractParentSessionIdFromHeaders(req?.headers);
      req.__logModelName = modelName;
      req.__logFlowName = flowName;
      req.__logSessionId = sessionId;
      req.__logParentSessionId = parentSessionId;
      logger.logRequest({
        req,
        bodyText,
        modelName,
        flowName,
        sessionId,
        parentSessionId,
        cacheDiagnostics: buildRequestCacheDiagnostics({
          bodyText,
          modelName,
          flowName,
          sessionId,
          parentSessionId,
        }),
      });
    });
  }

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
        logger.logResponse({
          proxyRes,
          bodyText: finalText,
          rawBodyText: text,
          modelName: req.__logModelName || unknownModelName,
          flowName: req.__logFlowName || unknownFlowName,
          sessionId: req.__logSessionId || unknownSessionId,
          parentSessionId: String(req.__logParentSessionId || '').trim(),
        });
      } catch (error) {
        logger.appendLog(
          `\n[Response Log Error] ${new Date().toLocaleString()} ${error.stack || error}\n`,
          req.__logModelName || unknownModelName,
          req.__logFlowName || unknownFlowName,
          req.__logSessionId || unknownSessionId,
          req.__logParentSessionId || '',
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

  server.listen(localPort, proxyHost, () => {
    console.log(`[model-proxy] Reverse proxy running on http://${proxyHost}:${localPort} -> ${targetUrl}`);
  });

  return server;
}

module.exports = {
  createHeaderExtractors,
  createProxyServer,
};
