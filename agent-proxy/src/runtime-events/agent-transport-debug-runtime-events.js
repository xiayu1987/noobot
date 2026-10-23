/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  AGENT_TRANSPORT_DEBUG_TYPE,
  summarizeAgentTransportCommand,
} from "@noobot/agent-transport-protocol";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRuntimeEvent,
} from "@noobot/runtime-events";

function resolveEventIdentity({ summary, socket, channel }) {
  if (channel) {
    const { userId, sessionId, parentSessionId } = channel.identity;
    return { scope: "session", userId, sessionId, parentSessionId };
  }
  const userId = socket.__agentProxyUserId;
  return {
    scope: summary.sessionId ? "session" : "system",
    userId,
    sessionId: summary.sessionId,
    parentSessionId: summary.parentSessionId,
  };
}

export function writeAgentTransportDebugEvent({ event, command, socket, channel, data }) {
  if (Boolean(socket) === Boolean(channel)) {
    throw new TypeError("agent transport debug event requires exactly one of socket or channel");
  }
  const summary = summarizeAgentTransportCommand(command, data);
  const { scope, userId, sessionId, parentSessionId } = resolveEventIdentity({
    summary,
    socket,
    channel,
  });
  return writeRuntimeEvent({
    scope,
    source: "agent-proxy",
    channel: RUNTIME_EVENT_CHANNELS.AGENT_PROXY_WEB_SOCKET,
    category: RUNTIME_EVENT_CATEGORIES.DEBUG,
    level: "debug",
    debugType: AGENT_TRANSPORT_DEBUG_TYPE,
    event,
    userId,
    sessionId,
    parentSessionId,
    dialogProcessId: summary.dialogProcessId,
    turnScopeId: summary.turnScopeId,
    data: { event, ...summary },
  });
}
