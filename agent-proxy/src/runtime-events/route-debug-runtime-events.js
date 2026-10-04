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

function parseChannelKeyPart(channelKey = "", index = 0) {
  return (
    String(channelKey || "")
      .split("::")
      [index]?.trim() || ""
  );
}

function firstTrimmed(...candidates) {
  return String(candidates.find(Boolean) || "").trim();
}

function firstLowerTrimmed(...candidates) {
  return firstTrimmed(...candidates).toLowerCase();
}

function resolvePayloadSessionId(payload) {
  return firstTrimmed(payload?.identity?.sessionId, payload?.sessionId);
}

function resolveRouteIdentity({ payload, socket, channel, data }) {
  const identity = payload?.identity;
  return {
    userId: firstTrimmed(
      socket?.__agentProxyUserId,
      data?.userId,
      channel?.ownerUserId,
      parseChannelKeyPart(channel?.key, 0),
    ),
    sessionId: firstTrimmed(
      identity?.sessionId,
      payload?.sessionId,
      data?.sessionId,
      channel?.startPayload?.identity?.sessionId,
      parseChannelKeyPart(channel?.key, 1),
    ),
    dialogProcessId: firstTrimmed(
      identity?.dialogProcessId,
      payload?.dialogProcessId,
      data?.dialogProcessId,
    ),
    turnScopeId: firstTrimmed(identity?.turnScopeId, payload?.turnScopeId, data?.turnScopeId),
  };
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
  workspaceRoot,
} = {}) {
  const route = { payload, socket, channel, data };
  return writeRoutedRuntimeEvent({
    source: "agent-proxy",
    channel: RUNTIME_EVENT_CHANNELS.AGENT_PROXY_WEB_SOCKET,
    category: RUNTIME_EVENT_CATEGORIES.DEBUG,
    level: "debug",
    debugType: "agent-proxy-route",
    event,
    ...resolveRouteIdentity(route),
    workspaceRoot,
    data: summarizeRouteData(route),
  });
}
