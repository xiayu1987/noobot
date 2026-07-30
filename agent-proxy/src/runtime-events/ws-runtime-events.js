/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRoutedRuntimeEvent,
} from "@noobot/runtime-events";
import { ensureConnectionId } from "../shared/utils.js";

function resolveRawDataInfo(rawData) {
  const rawDataType = Buffer.isBuffer(rawData) ? "buffer" : typeof rawData;
  const rawText = String(rawData || "");
  return {
    rawDataType,
    rawDataLength: rawText.length,
  };
}

export function writeAgentProxyInvalidJsonPayloadEvent({
  rawData,
  workspaceRoot,
} = {}) {
  return writeRoutedRuntimeEvent({
    source: "agent-proxy",
    channel: RUNTIME_EVENT_CHANNELS.AGENT_PROXY_WEB_SOCKET,
    category: RUNTIME_EVENT_CATEGORIES.TRANSPORT,
    level: "warn",
    event: "agentProxy.ws.invalidJsonPayload",
    workspaceRoot,
    data: resolveRawDataInfo(rawData),
  });
}

export function writeAgentProxyWebSocketLifecycleEvent({ event, socket = null, data = {}, workspaceRoot } = {}) {
  return writeRoutedRuntimeEvent({
    source: "agent-proxy", channel: RUNTIME_EVENT_CHANNELS.AGENT_PROXY_WEB_SOCKET,
    category: "agent-proxy-websocket", level: "info", event, workspaceRoot,
    data: { connectionId: ensureConnectionId(socket), readyState: socket?.readyState ?? null, ...data },
  });
}

export function writeAgentProxyRouteLifecycleEvent({ event, socket = null, channel = null, data = {}, workspaceRoot } = {}) {
  return writeRoutedRuntimeEvent({
    source: "agent-proxy", channel: RUNTIME_EVENT_CHANNELS.AGENT_PROXY_WEB_SOCKET,
    category: RUNTIME_EVENT_CATEGORIES.AGENT_PROXY_ROUTE, level: "info", event, workspaceRoot,
    data: { connectionId: ensureConnectionId(socket), channelStatus: String(channel?.status || ""), upstreamReadyState: channel?.upstreamSocket?.readyState ?? null, ...data },
  });
}

export function writeAgentProxyDataPlaneMetricsEvent({ metrics, workspaceRoot } = {}) {
  if (!metrics) return Promise.resolve({ ok: true, skipped: true });
  return writeRoutedRuntimeEvent({
    scope: "system",
    source: "agent-proxy",
    channel: RUNTIME_EVENT_CHANNELS.PROCESS,
    category: RUNTIME_EVENT_CATEGORIES.TRANSPORT,
    level: "info",
    event: "agentProxy.dataPlane.success.summary",
    workspaceRoot,
    data: metrics,
  });
}
