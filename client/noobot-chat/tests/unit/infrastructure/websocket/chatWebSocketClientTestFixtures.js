/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, beforeEach, vi } from "vitest";
import {
  AGENT_COMMAND,
  AGENT_COMMAND_RECEIPT_OUTCOME,
  AGENT_TRANSPORT_EVENT,
  createAgentCommandReceipt,
  createReconnectComplete,
  createTurnRunCommand,
} from "@noobot/agent-transport-protocol";
import { createEventEnvelope, EVENT_FAMILY, getEventFamily } from "@noobot/event-protocol";
import { TURN_LIFECYCLE_WIRE_EVENT } from "@noobot/session-protocol";

export class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];
  static initialReadyState = MockWebSocket.OPEN;

  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.initialReadyState;
    this.sent = [];
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    MockWebSocket.instances.push(this);
  }

  send(payload) {
    this.sent.push(payload);
  }

  close(code = 1000, reason = "") {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  emit(event, data = {}, channelSessionId = "") {
    this.onmessage?.({
      data: JSON.stringify({
        event,
        data,
        ...(channelSessionId ? { channelSessionId } : {}),
      }),
    });
  }
}

export const flushPromises = () => Promise.resolve();

export function readSentReconnectControl(socket) {
  const control = socket.sent
    .map((payload) => JSON.parse(payload))
    .findLast((payload) => payload.action === "reconnect");
  if (!control) throw new Error("reconnect_control_not_sent");
  return control;
}

export function emitReconnectComplete(socket, totalSessions) {
  const control = readSentReconnectControl(socket);
  socket.emit(
    AGENT_TRANSPORT_EVENT.RECONNECT_COMPLETE,
    createReconnectComplete(control, Array.from({ length: totalSessions })),
  );
}

export function streamCommand(identity) {
  return createTurnRunCommand({
    commandType: AGENT_COMMAND.SEND,
    identity,
    input: { message: "test", attachments: [] },
    presentation: {
      userMessageId: `user-message:${identity.turnScopeId}`,
      presentationMessageId: `assistant-message:${identity.turnScopeId}`,
    },
    concurrency: { expectedTurnRevision: 0, expectedAggregateVersion: 0 },
  });
}

export function emitCommandReceipt(
  socket,
  payload,
  { outcome = AGENT_COMMAND_RECEIPT_OUTCOME.COMPLETED, error } = {},
) {
  const receipt = createAgentCommandReceipt({
    commandId: payload.commandId,
    commandType: payload.commandType,
    outcome,
    identity: payload.identity,
    error,
    occurredAt: "2026-01-01T00:00:00.000Z",
  });
  socket.emit(AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT, receipt);
  return receipt;
}

export function turnLifecycleProtocolEvent(payload) {
  return createEventEnvelope({
    family: EVENT_FAMILY.TURN_LIFECYCLE,
    schemaVersion: getEventFamily(EVENT_FAMILY.TURN_LIFECYCLE).schemaVersion,
    identity: {
      eventId: payload.eventId,
      eventType: TURN_LIFECYCLE_WIRE_EVENT,
      sessionId: payload.sessionId,
      turnScopeId: payload.turnScopeId,
      executionId: payload.executionId,
    },
    causality: {
      commandId: payload.commandId,
      causationId: payload.causationId,
      correlationId: payload.correlationId,
    },
    ordering: {
      domain: "session",
      scopeId: payload.sessionId,
      sequence: payload.sequence,
      revision: payload.revision,
    },
    producer: { type: "test", id: "chat-websocket-client" },
    occurredAt: payload.occurredAt || "2026-01-01T00:00:00.000Z",
    payload,
  });
}

export function setupWebSocketTestHooks() {
  let originalWebSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    originalWebSocket = globalThis.WebSocket;
    MockWebSocket.instances = [];
    MockWebSocket.initialReadyState = MockWebSocket.OPEN;
    globalThis.WebSocket = MockWebSocket;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    vi.useRealTimers();
  });
}
