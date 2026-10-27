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
  ROOT_PARENT_SESSION_ID,
  createAgentCommandReceipt,
  createReconnectComplete,
  createTurnRunCommand,
  getAgentCommandIdentityKeys,
} from "@noobot/agent-transport-protocol";
import { createTurnLifecycleEventEnvelope } from "@noobot/event-protocol";

export function assertBrowserCloseCode(code) {
  if (code === 1000 || (code >= 3000 && code <= 4999)) return;
  const error = new Error(
    `The close code must be either 1000, or between 3000 and 4999. ${code} is neither.`,
  );
  error.name = "InvalidAccessError";
  throw error;
}

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
    assertBrowserCloseCode(code);
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  closeFromServer(code, reason = "") {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  emit(event, data) {
    this.onmessage?.({ data: JSON.stringify({ event, data }) });
  }

  emitChannel(channelSessionId, event, data) {
    this.onmessage?.({ data: JSON.stringify({ event, data, channelSessionId }) });
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

const ROOT_PARENT_IDENTITY = Object.freeze({
  parentSessionId: ROOT_PARENT_SESSION_ID,
});

export function rootCommandIdentity(commandType, identity) {
  const keys = getAgentCommandIdentityKeys(commandType);
  for (const key of Object.keys(identity)) {
    if (!keys.includes(key)) throw new TypeError(`test_identity_field_out_of_scope:${key}`);
  }
  const source = { ...ROOT_PARENT_IDENTITY, ...identity };
  return Object.fromEntries(keys.map((key) => [key, source[key]]));
}

export function streamCommand(scope) {
  const identity = rootCommandIdentity(AGENT_COMMAND.SEND, scope);
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
    command: {
      commandId: payload.commandId,
      commandType: payload.commandType,
      identity: payload.identity,
    },
    outcome,
    error,
    occurredAt: "2026-01-01T00:00:00.000Z",
  });
  socket.emitChannel(payload.identity.sessionId, AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT, receipt);
  return receipt;
}

export function turnLifecycleProtocolEvent(payload) {
  return createTurnLifecycleEventEnvelope(payload, {
    producer: { type: "test", id: "chat-websocket-client" },
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
