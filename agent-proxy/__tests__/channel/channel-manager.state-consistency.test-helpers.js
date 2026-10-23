/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createEventEnvelope,
  EVENT_FAMILY,
  INTERACTION_EVENT_TYPE,
  INTERACTION_SEQUENCE_DOMAIN,
  getEventFamily,
} from "@noobot/event-protocol";
import {
  MESSAGE_EVENT_SEQUENCE_DOMAIN,
  MESSAGE_EVENT_TYPE,
  MESSAGE_EVENT_WIRE_EVENT,
} from "@noobot/event-protocol/message-event";
import { createReconnectControl } from "@noobot/agent-transport-protocol";
import { initializeDownstreamSocketState } from "../../src/websocket/downstream-socket-state.js";

export function reconnectControl({
  sessionId = "",
  parentSessionId = "",
  parentDialogProcessId = "",
  requestId = "reconnect-test",
  knownLifecycleSequenceMap = {},
} = {}) {
  return createReconnectControl({
    requestId,
    identity: { sessionId, parentSessionId, parentDialogProcessId },
    knownLifecycleSequenceMap,
  });
}

export function canonicalMessageEvent({
  sequence = 1,
  sessionId = "session-1",
  turnScopeId = "turn-1",
  dialogProcessId = "dialog-1",
  presentationMessageId = `message-${sequence}`,
  eventType = MESSAGE_EVENT_TYPE.THINKING,
  text = "content",
} = {}) {
  return createEventEnvelope({
    family: EVENT_FAMILY.MESSAGE_TIMELINE,
    schemaVersion: getEventFamily(EVENT_FAMILY.MESSAGE_TIMELINE).schemaVersion,
    identity: {
      eventId: `message-event:${presentationMessageId}:${sequence}`,
      eventType: MESSAGE_EVENT_WIRE_EVENT,
      sessionId,
      turnScopeId,
    },
    causality: {},
    ordering: {
      domain: MESSAGE_EVENT_SEQUENCE_DOMAIN,
      scopeId: presentationMessageId,
      sequence,
    },
    producer: { type: "test", id: "agent-proxy-test" },
    occurredAt: "2026-08-17T00:00:00.000Z",
    payload: { eventType, presentationMessageId, dialogProcessId, text },
  });
}

export function canonicalInteractionRequest({
  requestId,
  sessionId = "session-1",
  turnScopeId = "turn-1",
  dialogProcessId = "dialog-1",
  sequence = 1,
  ...payload
} = {}) {
  return createEventEnvelope({
    family: EVENT_FAMILY.INTERACTION_REQUEST,
    schemaVersion: getEventFamily(EVENT_FAMILY.INTERACTION_REQUEST).schemaVersion,
    identity: {
      eventId: `interaction-event:${requestId}:${sequence}`,
      eventType: INTERACTION_EVENT_TYPE.REQUEST,
      sessionId,
      turnScopeId,
    },
    causality: {},
    ordering: { domain: INTERACTION_SEQUENCE_DOMAIN, scopeId: requestId, sequence },
    producer: { type: "test", id: "agent-proxy-test" },
    occurredAt: "2026-08-17T00:00:00.000Z",
    payload: { requestId, dialogProcessId, ...payload },
  });
}

export function createMockSocket({ apiKey = "api-key-1", userId = "user-1" } = {}) {
  return initializeDownstreamSocketState({
    readyState: 1,
    sentEvents: [],
    __agentProxyApiKey: apiKey,
    __agentProxyUserId: userId,
    send(raw) {
      this.sentEvents.push(JSON.parse(String(raw || "{}")));
    },
  });
}

export function getEvent(socket, eventName) {
  return socket.sentEvents.find((eventItem) => eventItem?.event === eventName) || null;
}

export function listEvents(socket, eventName) {
  return socket.sentEvents.filter((eventItem) => eventItem?.event === eventName);
}

export class FakeUpstreamWebSocket {
  static OPEN = 1;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = FakeUpstreamWebSocket.OPEN;
    this.handlers = new Map();
    this.sent = [];
    FakeUpstreamWebSocket.instances.push(this);
  }

  on(eventName, handler) {
    this.handlers.set(eventName, handler);
  }

  emit(eventName, ...args) {
    this.handlers.get(eventName)?.(...args);
  }

  send(raw) {
    this.sent.push(String(raw || ""));
  }

  close(code = 1000, reason = "") {
    this.readyState = 3;
    this.emit("close", code, Buffer.from(String(reason || "")));
  }
}

export function sortReconnectSessions(payload = {}) {
  const sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
  return sessions
    .map((sessionEntry) => ({
      sessionId: String(sessionEntry?.sessionId || ""),
      replayBatch: sessionEntry?.replayBatch || null,
    }))
    .sort((left, right) => left.sessionId.localeCompare(right.sessionId));
}

export function registerPendingCommand(manager, channel, commandId, { kind, socket, settle }) {
  return manager.commandRegistry.register(commandId, {
    channelKey: channel.key,
    kind,
    socket,
    settle,
  });
}

export function pendingCommand(manager, channel, commandId, kind) {
  const record = manager.commandRegistry.commands.get(commandId);
  return record && record.channelKey === channel.key && record.kind === kind ? record : null;
}

export function countPendingCommands(manager, channel, kind) {
  return [...manager.commandRegistry.commands.values()].filter(
    (record) => record.channelKey === channel.key && record.kind === kind,
  ).length;
}

export function deliverPendingCommand(manager, channel, commandId, kind, outcome) {
  const record = manager.commandRegistry.take(
    commandId,
    { channelKey: channel.key, kind },
    "delivered",
  );
  record.settle(outcome);
}
