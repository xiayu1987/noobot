/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AGENT_TRANSPORT_EVENT } from "@noobot/agent-transport-protocol";
import { TURN_LIFECYCLE_WIRE_EVENT } from "@noobot/session-protocol";
import { writeAgentProxyRouteLifecycleEvent } from "../../../runtime-events/ws-runtime-events.js";

export function publishEmptyReconnect(manager, socket, { currentSessionId, requestId }) {
  manager.sendSocketEvent(socket, {
    event: AGENT_TRANSPORT_EVENT.RECONNECT_DATA,
    data: { currentSessionId, sessions: [], requestId },
  });
  manager.sendSocketEvent(socket, {
    event: AGENT_TRANSPORT_EVENT.RECONNECT_COMPLETE,
    data: { totalSessions: 0, requestId },
  });
  void writeAgentProxyRouteLifecycleEvent({
    event: "agentProxy.route.reconnect.completed",
    socket,
    data: { totalSessions: 0 },
  });
}

function publishBufferedEvents(manager, socket, transaction) {
  const bufferedEvents = transaction.eventBuffer;
  socket.__agentProxyReconnectTransaction = null;
  for (const bufferedEvent of bufferedEvents) {
    const envelope = bufferedEvent?.envelope;
    if (!envelope) continue;
    const channel = manager.channelStore.get(bufferedEvent.channelKey);
    const sendResult = manager.sendChannelEvent(channel, socket, envelope);
    if (!["sent", "queued"].includes(sendResult.result)) continue;
    if (envelope.event === TURN_LIFECYCLE_WIRE_EVENT) continue;
    socket.__agentProxyLastSequenceByChannel ||= {};
    socket.__agentProxyLastSequenceByChannel[bufferedEvent.channelKey] = Number(
      bufferedEvent.sequence || 0,
    );
  }
}

export function publishReconnectTransaction({
  manager,
  socket,
  transaction,
  currentSessionId,
  requestId,
  sessions,
}) {
  manager.sendSocketEvent(socket, {
    event: AGENT_TRANSPORT_EVENT.RECONNECT_DATA,
    data: { currentSessionId, sessions, requestId },
  });
  for (const envelope of transaction.channelStateBaseline) {
    manager.sendSocketEvent(socket, envelope);
  }
  publishBufferedEvents(manager, socket, transaction);
  manager.sendSocketEvent(socket, {
    event: AGENT_TRANSPORT_EVENT.RECONNECT_COMPLETE,
    data: { totalSessions: sessions.length, requestId },
  });
  void writeAgentProxyRouteLifecycleEvent({
    event: "agentProxy.route.reconnect.completed",
    socket,
    data: { totalSessions: sessions.length },
  });
}
