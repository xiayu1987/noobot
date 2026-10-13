/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRuntimeEvent,
} from "@noobot/runtime-events";

function resolveRequestUrlInfo({ requestUrl = "", method = "" } = {}) {
  const rawUrl = String(requestUrl || "");
  return {
    method:
      String(method || "")
        .trim()
        .toUpperCase() || "GET",
    requestUrlLength: rawUrl.length,
  };
}

export function writeAgentProxyInvalidRequestUrlEvent({
  requestUrl = "",
  method = "",
  error = null,
} = {}) {
  return writeRuntimeEvent({
    scope: "system",
    source: "agent-proxy",
    channel: RUNTIME_EVENT_CHANNELS.DIRECT,
    category: RUNTIME_EVENT_CATEGORIES.TRANSPORT,
    level: "warn",
    event: "agentProxy.http.invalidRequestUrl",
    data: resolveRequestUrlInfo({ requestUrl, method }),
    error,
  });
}

export function writeAgentProxyUpstreamRequestFailedEvent({
  method = "",
  pathname = "",
  statusCode = 502,
  timeoutMs = 0,
  timedOut = false,
  error = null,
} = {}) {
  return writeRuntimeEvent({
    scope: "system",
    source: "agent-proxy",
    channel: RUNTIME_EVENT_CHANNELS.DIRECT,
    category: RUNTIME_EVENT_CATEGORIES.TRANSPORT,
    level: timedOut ? "warn" : "error",
    event: timedOut
      ? "agentProxy.http.upstreamRequest.timeout"
      : "agentProxy.http.upstreamRequest.failed",
    data: {
      method:
        String(method || "")
          .trim()
          .toUpperCase() || "GET",
      pathname: String(pathname || "").slice(0, 200),
      statusCode: Number(statusCode || 502),
      timeoutMs: Number(timeoutMs || 0),
      timedOut: Boolean(timedOut),
    },
    error,
  });
}

export function writeAgentProxyHttpTraceEvent({
  event = "",
  traceId = "",
  method = "",
  pathname = "",
  status = 0,
  contentType = "",
  contentDisposition = false,
  error = "",
} = {}) {
  return writeRuntimeEvent({
    scope: "system",
    source: "agent-proxy",
    channel: RUNTIME_EVENT_CHANNELS.DIRECT,
    category: RUNTIME_EVENT_CATEGORIES.DEBUG,
    level: "debug",
    debugType: "agent-proxy-http-trace",
    event: "agentProxy.http.trace",
    data: {
      traceEvent: String(event || ""),
      traceIdLength: String(traceId || "").length,
      method:
        String(method || "")
          .trim()
          .toUpperCase() || "GET",
      pathname: String(pathname || "").slice(0, 200),
      status: Number(status || 0),
      contentType: String(contentType || "").slice(0, 120),
      contentDisposition: Boolean(contentDisposition),
      errorMessage: String(error || "").slice(0, 300),
    },
  });
}

export function writeAgentProxyHttpLifecycleEvent({
  event,
  method = "",
  pathname = "",
  traceId = "",
  status = 0,
  durationMs = 0,
} = {}) {
  return writeRuntimeEvent({
    scope: "system",
    source: "agent-proxy",
    channel: RUNTIME_EVENT_CHANNELS.DIRECT,
    category: "agent-proxy-http",
    level: "info",
    event,
    data: {
      method: String(method || "").toUpperCase() || "GET",
      pathname: String(pathname || "").slice(0, 200),
      traceIdLength: String(traceId || "").length,
      status: Number(status || 0),
      durationMs: Number(durationMs || 0),
    },
  });
}
