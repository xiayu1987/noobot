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
import { summarizeChannelState } from "./route-debug-runtime-events.js";

function resolveRawDataInfo(rawData) {
  const rawDataType = Buffer.isBuffer(rawData) ? "buffer" : typeof rawData;
  const rawText = String(rawData || "");
  return {
    rawDataType,
    rawDataLength: rawText.length,
  };
}

export function writeAgentProxyInvalidJsonPayloadEvent({ rawData } = {}) {
  return writeRuntimeEvent({
    scope: "system",
    source: "agent-proxy",
    channel: RUNTIME_EVENT_CHANNELS.AGENT_PROXY_WEB_SOCKET,
    category: RUNTIME_EVENT_CATEGORIES.TRANSPORT,
    level: "warn",
    event: "agentProxy.ws.invalidJsonPayload",
    data: resolveRawDataInfo(rawData),
  });
}

function summarizeLifecycleSocket(socket) {
  if (!socket) return {};
  return { connectionId: socket.__agentProxySocketId, readyState: socket.readyState };
}

export function writeAgentProxyWebSocketLifecycleEvent({ event, socket, data }) {
  return writeRuntimeEvent({
    scope: "system",
    source: "agent-proxy",
    channel: RUNTIME_EVENT_CHANNELS.AGENT_PROXY_WEB_SOCKET,
    category: "agent-proxy-websocket",
    level: "info",
    event,
    data: { ...summarizeLifecycleSocket(socket), ...data },
  });
}

export function writeAgentProxyRouteLifecycleEvent({ event, socket, channel, data }) {
  return writeRuntimeEvent({
    scope: "system",
    source: "agent-proxy",
    channel: RUNTIME_EVENT_CHANNELS.AGENT_PROXY_WEB_SOCKET,
    category: RUNTIME_EVENT_CATEGORIES.AGENT_PROXY_ROUTE,
    level: "info",
    event,
    data: { ...summarizeLifecycleSocket(socket), ...summarizeChannelState(channel), ...data },
  });
}

export function writeAgentProxyDataPlaneMetricsEvent({ metrics } = {}) {
  if (!metrics) return Promise.resolve({ ok: true, skipped: true });
  return writeRuntimeEvent({
    scope: "system",
    source: "agent-proxy",
    channel: RUNTIME_EVENT_CHANNELS.PROCESS,
    category: RUNTIME_EVENT_CATEGORIES.TRANSPORT,
    level: "info",
    event: "agentProxy.dataPlane.success.summary",
    data: metrics,
  });
}
