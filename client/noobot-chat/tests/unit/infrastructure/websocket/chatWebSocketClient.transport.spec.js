/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { createChatWebSocketClient } from "../../../../src/infrastructure/websocket/chatWebSocketClient.js";
import { StreamEventEnum } from "../../../../src/modules/chat/model/chatConstants.js";
import {
  emitCommandReceipt,
  flushPromises,
  MockWebSocket,
  setupWebSocketTestHooks,
  streamCommand,
} from "./chatWebSocketClientTestFixtures.js";
import {
  AGENT_COMMAND_RECEIPT_OUTCOME,
  AGENT_TRANSPORT_EVENT,
  createAgentCommandReceipt,
} from "@noobot/agent-transport-protocol";
import { MESSAGE_EVENT_WIRE_EVENT } from "@noobot/event-protocol/message-event";
import { canonicalMessageEvent } from "../../modules/chat/helpers/messageEventFixture.js";
import {
  createTurnLifecycleEnvelope,
  TURN_EVENT,
  TURN_PHASE,
  TURN_STATE,
} from "@noobot/session-protocol";

setupWebSocketTestHooks();

describe("chatWebSocketClient transport lifecycle and failures", () => {
  it("does not reuse a websocket authenticated for a previous account", () => {
    let owner = "admin";
    let apiKey = "admin-key";
    const client = createChatWebSocketClient({
      resolveWebSocketUrl: () => `ws://test?apikey=${apiKey}`,
      resolveTransportOwner: () => owner,
    });

    const adminSocket = client.connect();
    owner = "xiayu";
    apiKey = "xiayu-key";
    const xiayuSocket = client.connect();

    expect(xiayuSocket).not.toBe(adminSocket);
    expect(adminSocket.readyState).toBe(MockWebSocket.CLOSED);
    expect(xiayuSocket.url).toBe("ws://test?apikey=xiayu-key");
    expect(client.getActiveSocket()).toBe(xiayuSocket);
  });

  it("settles a deleted Turn stream as an intentional cancellation", async () => {
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    const streamPromise = client.stream(
      streamCommand({
        sessionId: "session-delete",
        turnScopeId: "turn-delete",
      }),
      vi.fn(),
    );

    expect(
      client.cancelStreamForTurn({
        sessionId: "session-delete",
        turnScopeId: "turn-delete",
      }),
    ).toBe(true);
    await expect(streamPromise).resolves.toBeUndefined();
  });

  it("records every received protocol event at the shared websocket transport boundary", async () => {
    const sessionLogSink = { log: vi.fn(() => true) };
    const client = createChatWebSocketClient({
      resolveWebSocketUrl: () => "ws://test",
      sessionLogSink,
    });
    const onEvent = vi.fn();
    const payload = streamCommand({
        sessionId: "session-transport-log",
        turnScopeId: "turn-transport-log",
      });
    const streamPromise = client.stream(payload, onEvent);
    const socket = MockWebSocket.instances[0];
    const authoritativeEvent = canonicalMessageEvent({
      eventId: "event-transport-log",
      eventType: "authoritative_final_content",
      sessionId: "session-transport-log",
      parentSessionId: "parent-transport-log",
      dialogProcessId: "dialog-transport-log",
      turnScopeId: "turn-transport-log",
      messageId: "message-transport-log",
      presentationMessageId: "assistant-transport-log",
      sequence: 9,
      content: "complete assistant body",
      attachments: [{ path: "/workspace/result.txt" }],
      transferEnvelopes: [{ id: "transfer-1" }],
    });

    socket.emit(MESSAGE_EVENT_WIRE_EVENT, authoritativeEvent);

    expect(onEvent).toHaveBeenCalledWith({
      event: MESSAGE_EVENT_WIRE_EVENT,
      data: authoritativeEvent,
    });
    expect(sessionLogSink.log).toHaveBeenCalledWith({
      category: "transport",
      level: "debug",
      event: "frontend.websocket.transportEventReceived",
      sessionId: "session-transport-log",
      dialogProcessId: "dialog-transport-log",
      turnScopeId: "turn-transport-log",
      data: expect.objectContaining({
        protocolEvent: "message_event",
        eventId: "event-transport-log",
        eventType: "authoritative_final_content",
        parentSessionId: "parent-transport-log",
        messageId: "message-transport-log",
        presentationMessageId: "assistant-transport-log",
        transportSequence: null,
        authoritativeSequence: 9,
        contentLength: 23,
        attachmentCount: 1,
        transferEnvelopeCount: 1,
      }),
    });

    emitCommandReceipt(socket, payload);
    await streamPromise;
    expect(sessionLogSink.log).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "transport",
        event: "frontend.websocket.transportEventReceived",
        sessionId: "session-transport-log",
      }),
    );
  });

  it("uses channelSessionId only as transport routing identity", async () => {
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    const onEvent = vi.fn();
    const payload = streamCommand({ sessionId: "session-route", turnScopeId: "turn-route" });
    const streamPromise = client.stream(payload, onEvent);
    const socket = MockWebSocket.instances[0];
    const data = canonicalMessageEvent({
      eventId: "route-event",
      sessionId: "session-route",
      turnScopeId: "turn-route",
      messageId: "route-message",
      eventType: "llm_delta",
      text: "routed",
    });

    socket.emit(MESSAGE_EVENT_WIRE_EVENT, data, "another-session");
    expect(onEvent).not.toHaveBeenCalled();

    socket.emit(MESSAGE_EVENT_WIRE_EVENT, data, "session-route");
    expect(onEvent).toHaveBeenCalledWith({
      event: MESSAGE_EVENT_WIRE_EVENT,
      data,
      channelSessionId: "session-route",
    });
    expect(data.identity.sessionId).toBe("session-route");

    emitCommandReceipt(socket, payload);
    await streamPromise;
  });

  it("acknowledges authoritative lifecycle before handing it to the business reducer", async () => {
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    const onEvent = vi.fn();
    const payload = streamCommand({
        sessionId: "session-receipt-1",
        turnScopeId: "turn-receipt-1",
      });
    const streamPromise = client.stream(payload, onEvent);
    const socket = MockWebSocket.instances[0];
    socket.sent = [];
    const lifecycle = createTurnLifecycleEnvelope({
      eventType: TURN_EVENT.PROCESSING_STARTED,
      eventId: "event-receipt-1",
      commandId: "command-receipt-1",
      sessionId: "session-receipt-1",
      turnScopeId: "turn-receipt-1",
      messageId: "message-receipt-1",
      presentationMessageId: "assistant-receipt-1",
      dialogProcessId: "dialog-receipt-1",
      revision: 2,
      sequence: 2,
      phase: TURN_PHASE.PROCESSING,
      state: TURN_STATE.PROCESSING,
    });

    socket.emit("turn_lifecycle", lifecycle);

    expect(onEvent).toHaveBeenCalledWith({ event: "turn_lifecycle", data: lifecycle });
    expect(socket.sent.map((raw) => JSON.parse(raw))).toEqual([
      {
        action: "turn.lifecycle.received",
        protocolVersion: 1,
        eventId: "event-receipt-1",
        sessionId: "session-receipt-1",
        turnScopeId: "turn-receipt-1",
      },
    ]);
    emitCommandReceipt(socket, payload);
    await streamPromise;
  });

  it("keeps lifecycle delivery acknowledged when the business reducer throws", async () => {
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    const onEvent = vi.fn(() => {
      throw new Error("reducer failed");
    });
    const streamPromise = client.stream(
      streamCommand({
        sessionId: "session-receipt-before-reducer",
        turnScopeId: "turn-receipt-before-reducer",
      }),
      onEvent,
    );
    const socket = MockWebSocket.instances[0];
    socket.sent = [];
    const lifecycle = createTurnLifecycleEnvelope({
      eventType: TURN_EVENT.PROCESSING_STARTED,
      eventId: "event-receipt-before-reducer",
      commandId: "command-receipt-before-reducer",
      sessionId: "session-receipt-before-reducer",
      turnScopeId: "turn-receipt-before-reducer",
      messageId: "message-receipt-before-reducer",
      presentationMessageId: "assistant-receipt-before-reducer",
      dialogProcessId: "dialog-receipt-before-reducer",
      revision: 2,
      sequence: 2,
      phase: TURN_PHASE.PROCESSING,
      state: TURN_STATE.PROCESSING,
    });

    socket.emit("turn_lifecycle", lifecycle);

    expect(socket.sent.map((raw) => JSON.parse(raw))).toEqual([
      expect.objectContaining({
        action: "turn.lifecycle.received",
        eventId: "event-receipt-before-reducer",
      }),
    ]);
    await expect(streamPromise).rejects.toThrow("reducer failed");
  });

  it("does not acknowledge malformed lifecycle data", () => {
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    const socket = client.connect();

    socket.emit("turn_lifecycle", { eventId: "event-invalid" });

    expect(socket.sent).toEqual([]);
  });

  it("still dispatches authoritative lifecycle when writing its receipt fails", async () => {
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    const onEvent = vi.fn();
    const payload = streamCommand({
        sessionId: "session-receipt-failure",
        turnScopeId: "turn-receipt-failure",
      });
    const streamPromise = client.stream(payload, onEvent);
    const socket = MockWebSocket.instances[0];
    socket.send = () => {
      throw new Error("receipt send failed");
    };
    const lifecycle = createTurnLifecycleEnvelope({
      eventType: TURN_EVENT.PROCESSING_STARTED,
      eventId: "event-receipt-failure",
      commandId: "command-receipt-failure",
      sessionId: "session-receipt-failure",
      turnScopeId: "turn-receipt-failure",
      messageId: "message-receipt-failure",
      presentationMessageId: "assistant-receipt-failure",
      dialogProcessId: "dialog-receipt-failure",
      revision: 2,
      sequence: 2,
      phase: TURN_PHASE.PROCESSING,
      state: TURN_STATE.PROCESSING,
    });

    socket.emit("turn_lifecycle", lifecycle);

    expect(onEvent).toHaveBeenCalledWith({ event: "turn_lifecycle", data: lifecycle });
    emitCommandReceipt(socket, payload);
    await streamPromise;
  });

  it("sends userId in reconnect payload", async () => {
    const client = createChatWebSocketClient({
      resolveWebSocketUrl: () => "ws://test",
    });
    const reconnectPromise = client.reconnect({
      currentSessionId: "s-1",
      userId: "u-1",
      onReconnectData: vi.fn(),
    });
    const socket = MockWebSocket.instances[0];

    socket.onopen?.();

    expect(JSON.parse(socket.sent[0])).toEqual(
      expect.objectContaining({
        action: "reconnect",
        currentSessionId: "s-1",
        userId: "u-1",
        requestId: expect.stringMatching(/^reconnect:/),
      }),
    );

    socket.emit(StreamEventEnum.RECONNECT_COMPLETE, { totalSessions: 0 });
    await reconnectPromise;
  });

  it("records transport_ready without forwarding it into a business stream", async () => {
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    const onEvent = vi.fn();
    const payload = streamCommand({ sessionId: "s-ready", turnScopeId: "turn-ready" });
    const streamPromise = client.stream(payload, onEvent);
    const socket = MockWebSocket.instances[0];

    socket.emit("transport_ready", { serverInstanceId: "proxy-instance-1", protocolVersion: 2 });
    expect(client.getTransportStatus().serverInstanceId).toBe("proxy-instance-1");
    expect(onEvent).not.toHaveBeenCalled();

    emitCommandReceipt(socket, payload);
    await streamPromise;
  });

  it("extracts a readable message from structured stream errors", async () => {
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    const payload = streamCommand({
        sessionId: "s-error-object",
        turnScopeId: "turn-error-object",
      });
    const streamPromise = client.stream(payload, vi.fn());
    const socket = MockWebSocket.instances[0];

    const receipt = createAgentCommandReceipt({
      commandId: payload.commandId,
      commandType: payload.commandType,
      outcome: AGENT_COMMAND_RECEIPT_OUTCOME.FAILED,
      identity: payload.identity,
      error: {
        code: "SESSION_AGGREGATE_VERSION_CONFLICT",
        message: "session version conflict",
      },
      occurredAt: "2026-01-01T00:00:00.000Z",
    });
    socket.emit(AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT, receipt);

    await expect(streamPromise).rejects.toMatchObject({
      message: "session version conflict",
      data: expect.objectContaining({
        error: expect.objectContaining({ code: "SESSION_AGGREGATE_VERSION_CONFLICT" }),
      }),
    });
  });

  it("physically closes an errored idle business socket without waiting for close", () => {
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    const socket = client.connect();

    socket.onerror?.(new Event("error"));

    expect(socket.readyState).toBe(MockWebSocket.CLOSED);
    expect(client.getActiveSocket()).toBe(null);
  });

  it("refreshes authentication and retries a stream handshake before sending the payload", async () => {
    MockWebSocket.initialReadyState = MockWebSocket.CONNECTING;
    let apiKey = "stale-key";
    const refreshAuthentication = vi.fn(async () => {
      apiKey = "fresh-key";
      return true;
    });
    const client = createChatWebSocketClient({
      resolveWebSocketUrl: () => `ws://test?apikey=${apiKey}`,
      refreshAuthentication,
    });
    const payload = streamCommand({ sessionId: "s-auth-retry", turnScopeId: "turn-auth-retry" });
    const streamPromise = client.stream(payload, vi.fn());
    const failedSocket = MockWebSocket.instances[0];

    failedSocket.onerror?.(new Event("error"));
    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(2));

    expect(refreshAuthentication).toHaveBeenCalledTimes(1);
    expect(failedSocket.sent).toEqual([]);
    const recoveredSocket = MockWebSocket.instances[1];
    expect(recoveredSocket.url).toContain("fresh-key");
    recoveredSocket.readyState = MockWebSocket.OPEN;
    recoveredSocket.onopen?.();
    expect(recoveredSocket.sent.map((item) => JSON.parse(item))).toEqual([payload]);

    emitCommandReceipt(recoveredSocket, payload);
    await expect(streamPromise).resolves.toBeUndefined();
  });

  it("rejects stream send failures and releases the failed transport", async () => {
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    const socket = client.connect();
    socket.send = () => {
      throw new DOMException("socket closing", "InvalidStateError");
    };

    await expect(
      client.stream(streamCommand({ turnScopeId: "turn-send-failed" }), vi.fn()),
    ).rejects.toMatchObject({ name: "InvalidStateError" });
    expect(client.getActiveSocket()).toBe(null);
    expect(socket.readyState).toBe(MockWebSocket.CLOSED);
  });

  it("rejects reconnect immediately when command send fails", async () => {
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    const socket = client.connect();
    socket.send = () => {
      throw new Error("send failed");
    };

    await expect(client.reconnect({ currentSessionId: "s-1" })).rejects.toThrow("send failed");
    expect(client.getActiveSocket()).toBe(null);
    expect(socket.readyState).toBe(MockWebSocket.CLOSED);
  });

  it("contains websocket constructor failures in connect and reconnect", async () => {
    globalThis.WebSocket = class ThrowingWebSocket {
      static OPEN = 1;
      static CONNECTING = 0;
      static CLOSED = 3;
      constructor() {
        throw new DOMException("invalid websocket url", "SyntaxError");
      }
    };
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "invalid" });

    expect(() => client.connect()).not.toThrow();
    expect(client.connect()).toBe(null);
    await expect(client.reconnect({ currentSessionId: "s-1" })).rejects.toThrow();
    expect(client.getTransportStatus()).toMatchObject({
      phase: "idle",
      hasSocket: false,
      lastFailureReason: "SyntaxError",
    });
  });

  it("calls onPayloadSent only after the stream payload is written to the websocket", async () => {
    const client = createChatWebSocketClient({
      resolveWebSocketUrl: () => "ws://test",
    });
    client.connect();
    const socket = MockWebSocket.instances[0];
    const onPayloadSent = vi.fn();

    const payload = streamCommand({ sessionId: "s-continue", turnScopeId: "turn-continue" });
    const streamPromise = client.stream(payload, vi.fn(), { onPayloadSent });

    expect(socket.sent.map((item) => JSON.parse(item))).toContainEqual(payload);
    expect(socket.sent.some((item) => Object.hasOwn(JSON.parse(item), "requestId"))).toBe(false);
    expect(onPayloadSent).toHaveBeenCalledTimes(1);
    expect(onPayloadSent).toHaveBeenCalledWith(payload);

    emitCommandReceipt(socket, payload);
    await streamPromise;
  });
});
