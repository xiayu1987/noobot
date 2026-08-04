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
  writeRoutedRuntimeEvent,
} from "@noobot/runtime-events";

export function writeAgentTransportDebugEvent({
  event,
  command,
  socket = null,
  channel = null,
  data = {},
  workspaceRoot,
} = {}) {
  const summary = summarizeAgentTransportCommand(command, data);
  return writeRoutedRuntimeEvent({
    scope: summary.sessionId ? "session" : "system",
    source: "agent-proxy",
    channel: RUNTIME_EVENT_CHANNELS.AGENT_PROXY_WEB_SOCKET,
    category: RUNTIME_EVENT_CATEGORIES.DEBUG,
    level: "debug",
    debugType: AGENT_TRANSPORT_DEBUG_TYPE,
    event,
    userId: String(socket?.__agentProxyUserId || channel?.ownerUserId || "").trim(),
    sessionId: summary.sessionId,
    parentSessionId: summary.parentSessionId,
    dialogProcessId: summary.dialogProcessId,
    turnScopeId: summary.turnScopeId,
    workspaceRoot,
    data: { debugType: AGENT_TRANSPORT_DEBUG_TYPE, event, ...summary },
  });
}
