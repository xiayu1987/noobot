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
import { text } from "@noobot/shared/value";

function firstTrimmed(...candidates) {
  return text(candidates.find(Boolean));
}

function firstLowerTrimmed(...candidates) {
  return firstTrimmed(...candidates).toLowerCase();
}

function resolvePayloadSessionId(payload) {
  return text(payload?.identity?.sessionId);
}

function summarizeRouteChannel(channel, data) {
  return {
    targetChannelKey: String(channel?.key || data?.targetChannelKey || ""),
    channelStatus: String(channel?.status || data?.channelStatus || ""),
    upstreamReadyState: channel?.upstreamSocket?.readyState ?? data?.upstreamReadyState ?? null,
  };
}

function summarizeRouteData({ payload, socket, channel, data }) {
  return {
    action: firstLowerTrimmed(payload?.action, data?.action),
    commandType: firstLowerTrimmed(payload?.commandType, data?.commandType),
    payloadSessionId: resolvePayloadSessionId(payload),
    payloadUserIdPresent: false,
    payloadChannelKeyPresent: Boolean(payload?.channelKey),
    socketUserIdPresent: Boolean(socket?.__agentProxyUserId),
    socketActiveChannelKeyPresent: Boolean(socket?.__agentProxyActiveChannelKey),
    ...summarizeRouteChannel(channel, data),
    ...data,
  };
}

export function writeAgentProxyRouteDebugEvent({
  event = "agentProxy.route.debug",
  payload = {},
  socket = null,
  channel = null,
  data = {},
} = {}) {
  const route = { payload, socket, channel, data };
  return writeRuntimeEvent({
    scope: "system",
    source: "agent-proxy",
    channel: RUNTIME_EVENT_CHANNELS.AGENT_PROXY_WEB_SOCKET,
    category: RUNTIME_EVENT_CATEGORIES.DEBUG,
    level: "debug",
    debugType: "agent-proxy-route",
    event,
    data: summarizeRouteData(route),
  });
}
