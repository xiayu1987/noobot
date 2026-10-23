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

export function summarizeChannelState(channel) {
  if (!channel) return {};
  const transport = channel.transport.status();
  return {
    targetChannelKey: channel.key,
    activityPhase: channel.activity.phase,
    retentionPhase: channel.retention.phase,
    terminalStatus: channel.retention.terminalStatus,
    transportPhase: transport.phase,
    transportReadyState: transport.readyState,
    transportPurpose: transport.purpose,
    transportEverConnected: transport.everConnected,
  };
}

function summarizeRouteCommand(command) {
  if (!command) return {};
  return { commandType: command.commandType, payloadSessionId: command.identity.sessionId };
}

function summarizeRouteSocket(socket) {
  if (!socket) return {};
  return { connectionId: socket.__agentProxySocketId, socketUserId: socket.__agentProxyUserId };
}

export function writeAgentProxyRouteDebugEvent({ event, payload, socket, channel, data }) {
  return writeRuntimeEvent({
    scope: "system",
    source: "agent-proxy",
    channel: RUNTIME_EVENT_CHANNELS.AGENT_PROXY_WEB_SOCKET,
    category: RUNTIME_EVENT_CATEGORIES.DEBUG,
    level: "debug",
    debugType: "agent-proxy-route",
    event,
    data: {
      ...summarizeRouteCommand(payload),
      ...summarizeRouteSocket(socket),
      ...summarizeChannelState(channel),
      ...data,
    },
  });
}
