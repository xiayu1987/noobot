/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import http from "node:http";
import { createProxyServer as createHttpProxyServer } from "http-proxy-3";
import { getHeaderValue } from "./common.js";
import { decodeBodyByEncoding, resolveFinalResponseBodyText } from "./response-body.js";

function normalizeTerminalError(error = null) {
  if (!error) return null;
  return {
    name: String(error?.name || "").trim() || undefined,
    message: String(error?.message || error?.code || error?.type || "").trim() || undefined,
    code: String(error?.code || "").trim() || undefined,
  };
}

function createRequestLogLifecycle({ logger, context = {} } = {}) {
  let requestLogged = false;
  let terminalLogged = false;
  let pendingTerminal = null;

  function writeTerminal(terminal = {}) {
    if (terminalLogged) return false;
    terminalLogged = true;
    logger.logTerminal({ ...context, ...terminal });
    return true;
  }

  function recordRequest(request = {}) {
    if (requestLogged) return false;
    requestLogged = true;
    logger.logRequest({ ...context, ...request });
    if (pendingTerminal) {
      const terminal = pendingTerminal;
      pendingTerminal = null;
      writeTerminal(terminal);
    }
    return true;
  }

  function settle(terminal = {}) {
    if (terminalLogged || pendingTerminal) return false;
    if (!requestLogged) {
      pendingTerminal = terminal;
      return true;
    }
    return writeTerminal(terminal);
  }

  return {
    recordRequest,
    settle,
    get requestLogged() {
      return requestLogged;
    },
    get terminalLogged() {
      return terminalLogged;
    },
  };
}

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
    if (!headers || typeof headers !== "object") return "";
    const candidates = [
      parentSessionIdHeaderKey,
      "parentsessionid",
      "parent-sessionid",
      "parent-session-id",
      "x-plugin-parent-session-id",
      "x-plugin-parent-sessionid",
      "x-parent-session-id",
      "x-parent-sessionid",
      "x-harness-parent-session-id",
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
  const proxy = createHttpProxyServer({
    target: targetUrl,
    changeOrigin: true,
    secure: false,
  });

  function createRequestContext(req) {
    return {
      modelName: headerExtractors.extractModelNameFromHeaders(req?.headers) || unknownModelName,
      flowName: headerExtractors.extractFlowFromHeaders(req?.headers) || unknownFlowName,
      sessionId: headerExtractors.extractSessionIdFromHeaders(req?.headers) || unknownSessionId,
      parentSessionId: headerExtractors.extractParentSessionIdFromHeaders(req?.headers),
    };
  }

  function logRequestStream(req, lifecycle, context) {
    const chunks = [];
    let bodyComplete = false;
    const recordRequest = () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      lifecycle.recordRequest({
        req,
        bodyText,
        bodyComplete,
        cacheDiagnostics: buildRequestCacheDiagnostics({
          bodyText,
          ...context,
        }),
      });
    };
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      bodyComplete = true;
      recordRequest();
    });
    req.on("aborted", () => {
      recordRequest();
      lifecycle.settle({
        outcome: "client_aborted",
        error: { message: "Client aborted before completing the request body." },
      });
    });
  }

  proxy.on("proxyRes", (proxyRes, req) => {
    const chunks = [];

    proxyRes.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
    });

    const lifecycle = req.__requestLogLifecycle;
    proxyRes.on("aborted", () => {
      lifecycle?.settle({
        outcome: "upstream_aborted",
        status: proxyRes.statusCode,
        headers: proxyRes.headers,
        error: { message: "Upstream response was aborted." },
      });
    });

    proxyRes.on("error", (error) => {
      lifecycle?.settle({
        outcome: "upstream_error",
        status: proxyRes.statusCode,
        headers: proxyRes.headers,
        error: normalizeTerminalError(error),
      });
    });

    proxyRes.on("end", async () => {
      try {
        const raw = Buffer.concat(chunks);
        const decoded = await decodeBodyByEncoding(raw, proxyRes.headers["content-encoding"]);
        const text = decoded.toString("utf8");
        const finalText = resolveFinalResponseBodyText(text, proxyRes.headers["content-type"]);
        lifecycle?.settle({
          outcome: "response",
          status: proxyRes.statusCode,
          headers: proxyRes.headers,
          bodyText: finalText,
          rawBodyText: text,
        });
      } catch (error) {
        lifecycle?.settle({
          outcome: "response_decode_error",
          status: proxyRes.statusCode,
          headers: proxyRes.headers,
          error: normalizeTerminalError(error),
        });
      }
    });
  });

  proxy.on("error", (err, req, res) => {
    console.error(`[model-proxy:${localPort}] Proxy error:`, err);
    req?.__requestLogLifecycle?.settle({
      outcome: "proxy_error",
      error: normalizeTerminalError(err),
    });
    if (res && !res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Bad Gateway");
    } else if (res) {
      res.end();
    }
  });

  const server = http.createServer((req, res) => {
    const context = createRequestContext(req);
    const lifecycle = createRequestLogLifecycle({ logger, context });
    req.__requestLogLifecycle = lifecycle;
    logRequestStream(req, lifecycle, context);
    res.on("close", () => {
      if (res.writableEnded) return;
      lifecycle.settle({
        outcome: "client_aborted",
        error: { message: "Client disconnected before the response completed." },
      });
    });
    proxy.web(req, res);
  });

  server.listen(localPort, proxyHost, () => {
    console.log(
      `[model-proxy] Reverse proxy running on http://${proxyHost}:${localPort} -> ${targetUrl}`,
    );
  });

  return server;
}

export { createHeaderExtractors, createProxyServer, createRequestLogLifecycle };
