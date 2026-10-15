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
import { text } from "@noobot/shared/value";

function resolveEventIdentity({ summary, socket, channel }) {
  const channelIdentity = channel?.identity || null;
  if (channelIdentity && channelIdentity.sessionId === summary.sessionId) {
    return {
      userId: channelIdentity.userId,
      parentSessionId: summary.parentSessionId || channelIdentity.parentSessionId,
    };
  }
  return {
    userId: text(socket?.__agentProxyUserId || channelIdentity?.userId),
    parentSessionId: summary.parentSessionId,
  };
}

export function writeAgentTransportDebugEvent({
  event,
  command,
  socket = null,
  channel = null,
  data = {},
} = {}) {
  const summary = summarizeAgentTransportCommand(command, data);
  const { userId, parentSessionId } = resolveEventIdentity({ summary, socket, channel });
  return writeRuntimeEvent({
    scope: summary.sessionId ? "session" : "system",
    source: "agent-proxy",
    channel: RUNTIME_EVENT_CHANNELS.AGENT_PROXY_WEB_SOCKET,
    category: RUNTIME_EVENT_CATEGORIES.DEBUG,
    level: "debug",
    debugType: AGENT_TRANSPORT_DEBUG_TYPE,
    event,
    userId,
    sessionId: summary.sessionId,
    parentSessionId,
    dialogProcessId: summary.dialogProcessId,
    turnScopeId: summary.turnScopeId,
    data: { event, ...summary },
  });
}
