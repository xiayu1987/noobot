/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { createChatWebSocketClient } from "../../../../src/infrastructure/websocket/chatWebSocketClient.js";
import { StreamEventEnum } from "../../../../src/modules/chat/model/chatConstants.js";
import { flushPromises, MockWebSocket, setupWebSocketTestHooks } from "./chatWebSocketClientTestFixtures.js";
import {
  createTurnLifecycleEnvelope,
  TURN_EVENT,
  TURN_PHASE,
  TURN_STATE,
} from "@noobot/event-protocol";

setupWebSocketTestHooks();

describe("chatWebSocketClient transport lifecycle and failures", () => {
  it("acknowledges authoritative lifecycle only after handing it to the business reducer", async () => {
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    const onEvent = vi.fn();
    const streamPromise = client.stream({
      action: "chat",
      sessionId: "session-receipt-1",
      turnScopeId: "turn-receipt-1",
    }, onEvent);
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
    socket.emit(StreamEventEnum.DONE, {
      sessionId: "session-receipt-1",
      turnScopeId: "turn-receipt-1",
    });
    await streamPromise;
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
    const streamPromise = client.stream({
      action: "chat",
      sessionId: "session-receipt-failure",
      turnScopeId: "turn-receipt-failure",
    }, onEvent);
    const socket = MockWebSocket.instances[0];
    socket.send = () => { throw new Error("receipt send failed"); };
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
    socket.emit(StreamEventEnum.DONE, {
      sessionId: "session-receipt-failure",
      turnScopeId: "turn-receipt-failure",
    });
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

    expect(JSON.parse(socket.sent[0])).toEqual(expect.objectContaining({
      action: "reconnect",
      currentSessionId: "s-1",
      userId: "u-1",
      requestId: expect.stringMatching(/^reconnect:/),
    }));

    socket.emit(StreamEventEnum.RECONNECT_COMPLETE, { totalSessions: 0, cacheExpired: false });
    await reconnectPromise;
  });

  it("records transport_ready without forwarding it into a business stream", async () => {
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    const onEvent = vi.fn();
    const streamPromise = client.stream({ action: "chat", turnScopeId: "turn-ready" }, onEvent);
    const socket = MockWebSocket.instances[0];

    socket.emit("transport_ready", { serverInstanceId: "proxy-instance-1", protocolVersion: 2 });
    expect(client.getTransportStatus().serverInstanceId).toBe("proxy-instance-1");
    expect(onEvent).not.toHaveBeenCalled();

    const requestId = JSON.parse(socket.sent[0]).requestId;
    socket.emit(StreamEventEnum.DONE, { turnScopeId: "turn-ready", requestId });
    await streamPromise;
  });

  it("extracts a readable message from structured stream errors", async () => {
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    const streamPromise = client.stream({
      action: "chat",
      sessionId: "s-error-object",
      turnScopeId: "turn-error-object",
    }, vi.fn());
    const socket = MockWebSocket.instances[0];

    socket.emit(StreamEventEnum.ERROR, {
      sessionId: "s-error-object",
      turnScopeId: "turn-error-object",
      errorCode: "SESSION_VERSION_CONFLICT",
      error: { message: "session version conflict" },
    });

    await expect(streamPromise).rejects.toMatchObject({
      message: "session version conflict",
      data: expect.objectContaining({ errorCode: "SESSION_VERSION_CONFLICT" }),
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
    const payload = { action: "chat", sessionId: "s-auth-retry", turnScopeId: "turn-auth-retry" };
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
    expect(recoveredSocket.sent.map((item) => JSON.parse(item))).toEqual([
      expect.objectContaining({ ...payload, requestId: expect.stringMatching(/^stream:/) }),
    ]);

    recoveredSocket.emit(StreamEventEnum.DONE, {
      sessionId: payload.sessionId,
      turnScopeId: payload.turnScopeId,
    });
    await expect(streamPromise).resolves.toBeUndefined();
  });

  it("rejects stream send failures and releases the failed transport", async () => {
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    const socket = client.connect();
    socket.send = () => { throw new DOMException("socket closing", "InvalidStateError"); };

    await expect(client.stream({ action: "chat", turnScopeId: "turn-send-failed" }, vi.fn()))
      .rejects.toMatchObject({ name: "InvalidStateError" });
    expect(client.getActiveSocket()).toBe(null);
    expect(socket.readyState).toBe(MockWebSocket.CLOSED);
  });

  it("rejects reconnect immediately when command send fails", async () => {
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    const socket = client.connect();
    socket.send = () => { throw new Error("send failed"); };

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

    const streamPromise = client.stream(
      { action: "continue", turnScopeId: "turn-continue" },
      vi.fn(),
      { onPayloadSent },
    );

    expect(socket.sent.map((item) => JSON.parse(item))).toContainEqual(expect.objectContaining({
      action: "continue",
      turnScopeId: "turn-continue",
      requestId: expect.stringMatching(/^stream:/),
    }));
    expect(onPayloadSent).toHaveBeenCalledTimes(1);
    expect(onPayloadSent).toHaveBeenCalledWith(expect.objectContaining({
      action: "continue",
      turnScopeId: "turn-continue",
      requestId: expect.stringMatching(/^stream:/),
    }));

    socket.emit(StreamEventEnum.DONE, { turnScopeId: "turn-continue" });
    await streamPromise;
  });

});
