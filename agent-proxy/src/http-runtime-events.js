import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRoutedRuntimeEvent,
} from "@noobot/runtime-events";

function resolveRequestUrlInfo({ requestUrl = "", method = "" } = {}) {
  const rawUrl = String(requestUrl || "");
  return {
    method: String(method || "").trim().toUpperCase() || "GET",
    requestUrlLength: rawUrl.length,
  };
}

export function writeAgentProxyInvalidRequestUrlEvent({
  requestUrl = "",
  method = "",
  error = null,
  workspaceRoot,
} = {}) {
  return writeRoutedRuntimeEvent({
    source: "agent-proxy",
    channel: RUNTIME_EVENT_CHANNELS.DIRECT,
    category: RUNTIME_EVENT_CATEGORIES.TRANSPORT,
    level: "warn",
    event: "agentProxy.http.invalidRequestUrl",
    workspaceRoot,
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
  workspaceRoot,
} = {}) {
  return writeRoutedRuntimeEvent({
    source: "agent-proxy",
    channel: RUNTIME_EVENT_CHANNELS.DIRECT,
    category: RUNTIME_EVENT_CATEGORIES.TRANSPORT,
    level: timedOut ? "warn" : "error",
    event: timedOut
      ? "agentProxy.http.upstreamRequest.timeout"
      : "agentProxy.http.upstreamRequest.failed",
    workspaceRoot,
    data: {
      method: String(method || "").trim().toUpperCase() || "GET",
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
  workspaceRoot,
} = {}) {
  return writeRoutedRuntimeEvent({
    source: "agent-proxy",
    channel: RUNTIME_EVENT_CHANNELS.DIRECT,
    category: RUNTIME_EVENT_CATEGORIES.TRANSPORT,
    level: "debug",
    event: "agentProxy.http.trace",
    workspaceRoot,
    data: {
      traceEvent: String(event || ""),
      traceIdLength: String(traceId || "").length,
      method: String(method || "").trim().toUpperCase() || "GET",
      pathname: String(pathname || "").slice(0, 200),
      status: Number(status || 0),
      contentType: String(contentType || "").slice(0, 120),
      contentDisposition: Boolean(contentDisposition),
      errorMessage: String(error || "").slice(0, 300),
    },
  });
}
