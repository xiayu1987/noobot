/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import http from "node:http";
import https from "node:https";
import { config } from "./config.js";
import { AGENT_PROXY_ERROR } from "./constants.js";
import {
  localizeAgentProxyMessage,
  resolveLocaleFromRequest,
} from "noobot-i18n/agent-proxy";
import { buildSecurityHeaders } from "./security.js";
import {
  writeAgentProxyInvalidRequestUrlEvent,
  writeAgentProxyUpstreamRequestFailedEvent,
  writeAgentProxyHttpTraceEvent,
  writeAgentProxyHttpLifecycleEvent,
} from "./http-runtime-events.js";

function resolveSafeErrorMessage(statusCode = 502, message = "Bad Gateway") {
  if (Number(statusCode || 500) < 500) {
    return String(message || "Bad Gateway");
  }
  if (config.exposeUpstreamErrorDetail) {
    return String(message || "Bad Gateway");
  }
  return "Bad Gateway";
}

export function decorateProxyResponseHeaders(headers = {}) {
  return {
    ...headers,
    "x-agent-proxy": "noobot-agent-proxy",
    ...buildSecurityHeaders(),
  };
}

export function writeProxyError(
  response,
  statusCode = 502,
  message = "Bad Gateway",
  locale = "",
) {
  if (!response || response.headersSent) return;
  const localizedMessage = localizeAgentProxyMessage(message, locale) || message;
  response.writeHead(
    statusCode,
    decorateProxyResponseHeaders({ "Content-Type": "application/json" }),
  );
  response.end(
    JSON.stringify({
      ok: false,
      error: resolveSafeErrorMessage(statusCode, localizedMessage),
    }),
  );
}

export function collectRequestBody(request) {
  return new Promise((resolve, reject) => {
    if (!request) {
      resolve(Buffer.from(""));
      return;
    }
    let totalSize = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      totalSize += chunk.length;
      if (totalSize > config.maxBodySize) {
        request.destroy(new Error("request body too large"));
        reject(new Error("request body too large"));
        return;
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk || "")));
    });
    request.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    request.on("error", reject);
  });
}

export function normalizeProxyPathname(pathname = "/", stripPrefix = config.upstreamHttpStripPrefix) {
  const normalizedPathname = String(pathname || "/").trim() || "/";
  const normalizedStripPrefix = String(stripPrefix || "").trim();
  if (!normalizedStripPrefix || normalizedStripPrefix === "/") return normalizedPathname;
  if (normalizedPathname === normalizedStripPrefix) return "/";
  if (normalizedPathname.startsWith(`${normalizedStripPrefix}/`)) {
    return normalizedPathname.slice(normalizedStripPrefix.length) || "/";
  }
  return normalizedPathname;
}

export function proxyHttpRequest(request, response) {
  const startedAt = Date.now();
  const locale = resolveLocaleFromRequest(request);
  const method = String(request?.method || "GET").trim().toUpperCase() || "GET";
  const traceId = String(request?.headers?.["x-noobot-file-trace-id"] || "").trim();
  let targetUrl = null;
  try {
    targetUrl = new URL(request?.url || "/", config.upstreamHttpBase);
    targetUrl.pathname = normalizeProxyPathname(targetUrl.pathname);
  } catch (error) {
    void writeAgentProxyInvalidRequestUrlEvent({
      requestUrl: request?.url || "",
      method,
      error,
    });
    if (traceId) {
      void writeAgentProxyHttpTraceEvent({
        event: "proxy.invalidRequestUrl",
        traceId,
        method,
      });
    }
    writeProxyError(response, 400, AGENT_PROXY_ERROR.INVALID_REQUEST_URL, locale);
    return;
  }
  if (traceId) {
    void writeAgentProxyHttpTraceEvent({
      event: "proxy.request",
      traceId,
      method,
      pathname: targetUrl.pathname,
      hasSearch: Boolean(targetUrl.search),
    });
  }
  void writeAgentProxyHttpLifecycleEvent({ event: "agentProxy.http.request.started", method, pathname: targetUrl.pathname, traceId });
  const isHttps = targetUrl.protocol === "https:";
  const requestHeaders = { ...(request?.headers || {}) };
  delete requestHeaders.host;
  const transport = isHttps ? https : http;
  let upstreamTimedOut = false;
  const upstreamRequest = transport.request(
    {
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      method,
      path: `${targetUrl.pathname}${targetUrl.search}`,
      headers: requestHeaders,
      timeout: config.httpUpstreamTimeoutMs,
    },
    (upstreamResponse) => {
      const statusCode = Number(upstreamResponse?.statusCode || 502);
      void writeAgentProxyHttpLifecycleEvent({ event: "agentProxy.http.response.received", method, pathname: targetUrl.pathname, traceId, status: statusCode, durationMs: Date.now() - startedAt });
      if (traceId) {
        void writeAgentProxyHttpTraceEvent({
          event: "proxy.response",
          traceId,
          method,
          pathname: targetUrl.pathname,
          status: statusCode,
          contentType: String(upstreamResponse?.headers?.["content-type"] || ""),
          contentDisposition: Boolean(upstreamResponse?.headers?.["content-disposition"]),
        });
      }
      const responseHeaders = decorateProxyResponseHeaders({
        ...(upstreamResponse?.headers || {}),
      });
      response.writeHead(statusCode, responseHeaders);
      upstreamResponse.pipe(response);
    },
  );
  upstreamRequest.on("timeout", () => {
    upstreamTimedOut = true;
    upstreamRequest.destroy(new Error("upstream timeout"));
  });
  upstreamRequest.on("error", (error) => {
    void writeAgentProxyHttpLifecycleEvent({ event: "agentProxy.http.request.failed", method, pathname: targetUrl?.pathname || "", traceId, status: 502, durationMs: Date.now() - startedAt });
    void writeAgentProxyUpstreamRequestFailedEvent({
      method,
      pathname: targetUrl?.pathname || "",
      statusCode: 502,
      timeoutMs: config.httpUpstreamTimeoutMs,
      timedOut: upstreamTimedOut || String(error?.message || "") === "upstream timeout",
      error,
    });
    if (traceId) {
      void writeAgentProxyHttpTraceEvent({
        event: "proxy.failed",
        traceId,
        method,
        pathname: targetUrl?.pathname || "",
        error: String(error?.message || error || ""),
      });
    }
    writeProxyError(
      response,
      502,
      error?.message || AGENT_PROXY_ERROR.UPSTREAM_HTTP_ERROR,
      locale,
    );
  });
  request.pipe(upstreamRequest);
}
