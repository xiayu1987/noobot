/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import http from "node:http";
import https from "node:https";
import { config } from "../shared/config.js";
import { AGENT_PROXY_HTTP_ERROR_CODE } from "../shared/constants.js";
import { FILE_TRACE_ID_HEADER } from "@noobot/shared/runtime-events-config";
import { localizeAgentProxyError, resolveLocaleFromRequest } from "noobot-i18n/agent-proxy";
import { buildSecurityHeaders } from "./security.js";
import {
  writeAgentProxyInvalidRequestUrlEvent,
  writeAgentProxyUpstreamRequestFailedEvent,
  writeAgentProxyHttpTraceEvent,
  writeAgentProxyHttpLifecycleEvent,
} from "../runtime-events/http-runtime-events.js";
import { text } from "@noobot/shared/value";

function resolveProxyErrorText({ statusCode, code, locale, detail }) {
  if (statusCode < 500) return localizeAgentProxyError(code, locale);
  if (!config.exposeUpstreamErrorDetail) return "Bad Gateway";
  return detail || localizeAgentProxyError(code, locale);
}

export function decorateProxyResponseHeaders(headers = {}) {
  return {
    ...headers,
    "x-agent-proxy": "noobot-agent-proxy",
    ...buildSecurityHeaders(),
  };
}

export function writeProxyError(response, { statusCode, code, locale, detail }) {
  if (response.headersSent) return;
  response.writeHead(
    statusCode,
    decorateProxyResponseHeaders({ "Content-Type": "application/json" }),
  );
  response.end(
    JSON.stringify({
      ok: false,
      error: resolveProxyErrorText({ statusCode, code, locale, detail }),
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
        const tooLarge = Object.assign(new Error("request body too large"), {
          code: AGENT_PROXY_HTTP_ERROR_CODE.REQUEST_BODY_TOO_LARGE,
        });
        request.destroy(tooLarge);
        reject(tooLarge);
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

export function normalizeProxyPathname(
  pathname = "/",
  stripPrefix = config.upstreamHttpStripPrefix,
) {
  const normalizedPathname = text(pathname) || "/";
  const normalizedStripPrefix = text(stripPrefix);
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
  const method = (text(request?.method) || "GET").toUpperCase() || "GET";
  const traceId = text(request?.headers?.[FILE_TRACE_ID_HEADER]);
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
    writeProxyError(response, {
      statusCode: 400,
      code: AGENT_PROXY_HTTP_ERROR_CODE.INVALID_REQUEST_URL,
      locale,
    });
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
  void writeAgentProxyHttpLifecycleEvent({
    event: "agentProxy.http.request.started",
    method,
    pathname: targetUrl.pathname,
    traceId,
  });
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
      void writeAgentProxyHttpLifecycleEvent({
        event: "agentProxy.http.response.received",
        method,
        pathname: targetUrl.pathname,
        traceId,
        status: statusCode,
        durationMs: Date.now() - startedAt,
      });
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
    void writeAgentProxyHttpLifecycleEvent({
      event: "agentProxy.http.request.failed",
      method,
      pathname: targetUrl?.pathname || "",
      traceId,
      status: 502,
      durationMs: Date.now() - startedAt,
    });
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
    writeProxyError(response, {
      statusCode: 502,
      code: AGENT_PROXY_HTTP_ERROR_CODE.UPSTREAM_HTTP_ERROR,
      locale,
      detail: error.message,
    });
  });
  request.pipe(upstreamRequest);
}
