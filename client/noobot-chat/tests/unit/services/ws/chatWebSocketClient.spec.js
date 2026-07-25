/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChatWebSocketClient } from "../../../../src/services/ws/chatWebSocketClient";
import { StreamEventEnum } from "../../../../src/shared/constants/chatConstants";

class MockWebSocket {
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

  emit(event, data = {}) {
    this.onmessage?.({ data: JSON.stringify({ event, data }) });
  }
}

const flushPromises = () => Promise.resolve();

describe("chatWebSocketClient", () => {
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

  it("reuses the bootstrap socket for the initial reconnect handshake", async () => {
    const client = createChatWebSocketClient({
      resolveWebSocketUrl: () => "ws://test",
    });
    client.connect();
    const bootstrapSocket = MockWebSocket.instances[0];

    const reconnectPromise = client.reconnect({
      currentSessionId: "s-1",
      userId: "u-1",
      onReconnectData: vi.fn(),
    });

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(bootstrapSocket.sent).toHaveLength(1);
    expect(JSON.parse(bootstrapSocket.sent[0])).toMatchObject({
      action: "reconnect",
      currentSessionId: "s-1",
      userId: "u-1",
    });
    bootstrapSocket.emit(StreamEventEnum.RECONNECT_COMPLETE, { totalSessions: 0 });
    await reconnectPromise;
  });

  it("keeps restored-session live events subscribed after reconnect completes", async () => {
    const onReconnectData = vi.fn();
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    const reconnectPromise = client.reconnect({
      currentSessionId: "s-live-replay",
      userId: "u-1",
      onReconnectData,
    });
    const socket = MockWebSocket.instances[0];

    socket.emit(StreamEventEnum.RECONNECT_COMPLETE, { totalSessions: 1 });
    await reconnectPromise;
    socket.emit(StreamEventEnum.THINKING, {
      sessionId: "s-live-replay",
      dialogProcessId: "dp-live-replay",
      turnScopeId: "turn-live-replay",
      seq: 2,
      text: "continued thinking",
    });
    socket.emit(StreamEventEnum.DELTA, {
      sessionId: "s-live-replay",
      dialogProcessId: "dp-live-replay",
      turnScopeId: "turn-live-replay",
      seq: 3,
      content: "continued answer",
    });

    expect(onReconnectData).toHaveBeenNthCalledWith(1, {
      event: StreamEventEnum.THINKING,
      data: expect.objectContaining({ text: "continued thinking", seq: 2 }),
    });
    expect(onReconnectData).toHaveBeenNthCalledWith(2, {
      event: StreamEventEnum.DELTA,
      data: expect.objectContaining({ content: "continued answer", seq: 3 }),
    });
    expect(client.getLastReceivedSeqMap()).toEqual({ "dp-live-replay": 3 });
  });

  it("does not duplicate live events while an active stream owns the turn", async () => {
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    const onStreamEvent = vi.fn();
    const onReconnectData = vi.fn();
    const streamPromise = client.stream({
      action: "chat",
      sessionId: "s-live-owner",
      turnScopeId: "turn-live-owner",
    }, onStreamEvent);
    const socket = MockWebSocket.instances[0];
    const streamRequestId = JSON.parse(socket.sent[0]).requestId;
    const reconnectPromise = client.reconnect({
      currentSessionId: "s-live-owner",
      userId: "u-1",
      onReconnectData,
    });

    socket.emit(StreamEventEnum.RECONNECT_COMPLETE, { totalSessions: 1 });
    await reconnectPromise;
    socket.emit(StreamEventEnum.DELTA, {
      sessionId: "s-live-owner",
      turnScopeId: "turn-live-owner",
      requestId: streamRequestId,
      seq: 2,
      content: "owned by stream",
    });

    expect(onStreamEvent).toHaveBeenCalledWith({
      event: StreamEventEnum.DELTA,
      data: expect.objectContaining({ content: "owned by stream" }),
    });
    expect(onReconnectData).not.toHaveBeenCalled();

    socket.emit(StreamEventEnum.DONE, {
      sessionId: "s-live-owner",
      turnScopeId: "turn-live-owner",
      requestId: streamRequestId,
      seq: 3,
    });
    await streamPromise;
  });

  it("multiplexes reconnect on the active stream socket without opening another connection", async () => {
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    const onEvent = vi.fn();
    const streamPromise = client.stream({ action: "chat", sessionId: "s-1", turnScopeId: "turn-1" }, onEvent);
    const socket = MockWebSocket.instances[0];
    const streamRequestId = JSON.parse(socket.sent[0]).requestId;

    const reconnectPromise = client.reconnect({ currentSessionId: "s-1", userId: "u-1" });
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(JSON.parse(socket.sent[1])).toMatchObject({ action: "reconnect", currentTurnScopeId: "turn-1" });
    socket.emit(StreamEventEnum.RECONNECT_COMPLETE, { totalSessions: 1 });
    await reconnectPromise;
    socket.emit(StreamEventEnum.DONE, {
      sessionId: "s-1",
      turnScopeId: "turn-1",
      requestId: streamRequestId,
    });

    await expect(streamPromise).resolves.toBeUndefined();
    expect(socket.readyState).toBe(MockWebSocket.OPEN);
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

  it("retires the previous stream socket when reconnect replaces it", async () => {
    const client = createChatWebSocketClient({
      resolveWebSocketUrl: () => "ws://test",
    });
    client.connect();
    const streamSocket = MockWebSocket.instances[0];
    const onEvent = vi.fn();
    const streamPromise = client.stream({ action: "chat", sessionId: "s-1", turnScopeId: "turn-1" }, onEvent);
    const streamRequestId = JSON.parse(streamSocket.sent[0]).requestId;
    streamSocket.readyState = MockWebSocket.CLOSING;

    const reconnectPromise = client.reconnect({
      currentSessionId: "s-1",
      userId: "u-1",
      onReconnectData: vi.fn(),
    });
    const reconnectSocket = MockWebSocket.instances[1];
    expect(MockWebSocket.instances).toHaveLength(2);
    reconnectSocket.onopen?.();
    reconnectSocket.emit(StreamEventEnum.RECONNECT_COMPLETE, { totalSessions: 1 });
    await reconnectPromise;

    expect(streamSocket.readyState).toBe(MockWebSocket.CLOSED);
    expect(reconnectSocket.readyState).toBe(MockWebSocket.OPEN);
    reconnectSocket.emit(StreamEventEnum.DELTA, {
      sessionId: "s-1",
      turnScopeId: "turn-1",
      requestId: streamRequestId,
      content: "continued",
    });
    reconnectSocket.emit(StreamEventEnum.DONE, {
      sessionId: "s-1",
      turnScopeId: "turn-1",
      requestId: streamRequestId,
    });
    await expect(streamPromise).resolves.toBeUndefined();
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: StreamEventEnum.DELTA,
      data: expect.objectContaining({ content: "continued" }),
    }));
  });

  it("keeps the permanent transport dispatcher on a replacement socket", async () => {
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    const streamPromise = client.stream({ action: "chat", sessionId: "s-1", turnScopeId: "turn-1" }, vi.fn());
    const firstSocket = MockWebSocket.instances[0];
    const streamRequestId = JSON.parse(firstSocket.sent[0]).requestId;
    firstSocket.readyState = MockWebSocket.CLOSING;
    const reconnectPromise = client.reconnect({ currentSessionId: "s-1", userId: "u-1" });
    const replacementSocket = MockWebSocket.instances[1];

    replacementSocket.onopen?.();
    replacementSocket.emit(StreamEventEnum.RECONNECT_COMPLETE, { totalSessions: 1 });
    await reconnectPromise;
    replacementSocket.emit("transport_ready", { serverInstanceId: "proxy-after-reconnect" });

    expect(client.getTransportStatus().serverInstanceId).toBe("proxy-after-reconnect");
    replacementSocket.emit(StreamEventEnum.DONE, {
      sessionId: "s-1",
      turnScopeId: "turn-1",
      requestId: streamRequestId,
    });
    await streamPromise;
  });

  it("resolves command responses through the permanent dispatcher after reconnect", async () => {
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    const streamPromise = client.stream({ action: "chat", sessionId: "s-1", turnScopeId: "turn-1" }, vi.fn());
    const firstSocket = MockWebSocket.instances[0];
    const streamRequestId = JSON.parse(firstSocket.sent[0]).requestId;
    firstSocket.readyState = MockWebSocket.CLOSING;
    const reconnectPromise = client.reconnect({ currentSessionId: "s-1", userId: "u-1" });
    const replacementSocket = MockWebSocket.instances[1];

    replacementSocket.onopen?.();
    replacementSocket.emit(StreamEventEnum.RECONNECT_COMPLETE, { totalSessions: 1 });
    await reconnectPromise;
    const commandPromise = client.requestJson(
      { action: "turn.snapshot.get", commandId: "snapshot-after-reconnect" },
      { expectedEvents: ["turn_snapshot"] },
    );
    replacementSocket.emit("turn_snapshot", {
      commandId: "snapshot-after-reconnect",
      sessionId: "s-1",
    });

    await expect(commandPromise).resolves.toEqual({
      event: "turn_snapshot",
      data: { commandId: "snapshot-after-reconnect", sessionId: "s-1" },
    });
    replacementSocket.emit(StreamEventEnum.DONE, {
      sessionId: "s-1",
      turnScopeId: "turn-1",
      requestId: streamRequestId,
    });
    await streamPromise;
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

  it("delivers replayed errors without rejecting reconnect", async () => {
    const onReconnectData = vi.fn();
    const client = createChatWebSocketClient({
      resolveWebSocketUrl: () => "ws://test",
    });
    const reconnectPromise = client.reconnect({
      currentSessionId: "s-1",
      userId: "u-1",
      onReconnectData,
    });
    const socket = MockWebSocket.instances[0];

    socket.onopen?.();
    const errorData = {
      sessionId: "s-1",
      dialogProcessId: "dp-failed",
      seq: 36,
      error: "failed attempt",
    };
    socket.emit(StreamEventEnum.ERROR, errorData);
    socket.emit(StreamEventEnum.RECONNECT_COMPLETE, { totalSessions: 1, cacheExpired: false });

    await expect(reconnectPromise).resolves.toEqual({ totalSessions: 1, cacheExpired: false });
    expect(onReconnectData).toHaveBeenCalledWith({
      event: StreamEventEnum.ERROR,
      data: errorData,
    });
  });

  it("scopes stopRequested to the stopped turnScopeId", () => {
    const client = createChatWebSocketClient({
      resolveWebSocketUrl: () => "ws://test",
    });

    expect(client.isStopRequested()).toBe(false);
    expect(client.getStopRequestedTurnScopeId()).toBe("");

    client.requestStop({ turnScopeId: "turn-stop" }, vi.fn());

    expect(client.isStopRequested()).toBe(true);
    expect(client.getStopRequestedTurnScopeId()).toBe("turn-stop");

    client.clearStopRequested();

    expect(client.isStopRequested()).toBe(false);
    expect(client.getStopRequestedTurnScopeId()).toBe("");
  });

  it("does not resolve after completed channel_state before DONE", async () => {
    const client = createChatWebSocketClient({
      resolveWebSocketUrl: () => "ws://test",
      terminalChannelStateGraceMs: 20,
    });
    client.connect();
    const socket = MockWebSocket.instances[0];
    const onEvent = vi.fn();
    let resolved = false;

    const streamPromise = client.stream({ action: "chat" }, onEvent).then(() => {
      resolved = true;
    });

    socket.emit(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-1",
      state: "completed",
      seq: 2,
    });

    expect(onEvent).toHaveBeenCalledWith({
      event: StreamEventEnum.CHANNEL_STATE,
      data: {
        sessionId: "s-1",
        dialogProcessId: "dp-1",
        state: "completed",
        seq: 2,
      },
    });
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(19);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(false);
    socket.emit(StreamEventEnum.DONE, {
      sessionId: "s-1",
      dialogProcessId: "dp-1",
      seq: 3,
    });
    await streamPromise;
    expect(resolved).toBe(true);
    expect(client.getLastReceivedSeqMap()).toEqual({});
  });

  it("does not resolve stream for non-terminal channel_state", async () => {
    const client = createChatWebSocketClient({
      resolveWebSocketUrl: () => "ws://test",
      terminalChannelStateGraceMs: 20,
    });
    client.connect();
    const socket = MockWebSocket.instances[0];
    let settled = false;

    client.stream({ action: "chat" }, vi.fn()).then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    socket.emit(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-1",
      state: "sending",
      seq: 1,
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(false);
  });

  it("does not settle a scoped stream from an unscoped no_conversation prelude", async () => {
    const client = createChatWebSocketClient({
      resolveWebSocketUrl: () => "ws://test",
      terminalChannelStateGraceMs: 20,
    });
    client.connect();
    const socket = MockWebSocket.instances[0];
    const onEvent = vi.fn();
    let resolved = false;

    const streamPromise = client
      .stream({ action: "chat", sessionId: "s-1", turnScopeId: "turn-live" }, onEvent)
      .then(() => {
        resolved = true;
      });

    socket.emit(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      state: "no_conversation",
      seq: 0,
    });
    await vi.advanceTimersByTimeAsync(30);
    await flushPromises();

    expect(resolved).toBe(false);

    socket.emit(StreamEventEnum.THINKING, {
      sessionId: "s-1",
      dialogProcessId: "dp-live",
      turnScopeId: "turn-live",
      seq: 1,
      text: "still running",
    });
    expect(onEvent).toHaveBeenCalledWith({
      event: StreamEventEnum.THINKING,
      data: expect.objectContaining({
        dialogProcessId: "dp-live",
        turnScopeId: "turn-live",
      }),
    });
    expect(resolved).toBe(false);

    socket.emit(StreamEventEnum.DONE, {
      sessionId: "s-1",
      dialogProcessId: "dp-live",
      turnScopeId: "turn-live",
      seq: 2,
    });
    await streamPromise;
    expect(resolved).toBe(true);
  });

  it("does not treat stop-requested socket close as successful final state", async () => {
    const client = createChatWebSocketClient({
      resolveWebSocketUrl: () => "ws://test",
      stopConfirmationTimeoutMs: 1000,
      translateText: (key) => key,
    });
    client.connect();
    const socket = MockWebSocket.instances[0];

    const streamPromise = client.stream({ action: "chat" }, vi.fn());
    client.requestStop({ turnScopeId: "turn-stop" }, vi.fn());
    socket.close(1000, "server_closed_without_terminal_event");

    await expect(streamPromise).rejects.toThrow("infra.websocketStreamError");
  });

  it("requestStop rejects the stream when backend stop confirmation times out", async () => {
    const client = createChatWebSocketClient({
      resolveWebSocketUrl: () => "ws://test",
      stopConfirmationTimeoutMs: 1000,
    });
    client.connect();
    const socket = MockWebSocket.instances[0];
    const onStopConfirmationTimeout = vi.fn();
    let settled = false;

    const streamPromise = client.stream({ action: "chat", turnScopeId: "turn-stop" }, vi.fn())
      .finally(() => {
        settled = true;
      });
    const rejectionExpectation = expect(streamPromise).rejects.toMatchObject({
      code: "STOP_CONFIRMATION_TIMEOUT",
      data: expect.objectContaining({
        sessionId: "s-1",
        turnScopeId: "turn-stop",
      }),
    });

    const result = client.requestStop({ turnScopeId: "turn-stop", sessionId: "s-1" }, onStopConfirmationTimeout);

    expect(result).toBe(true);
    expect(JSON.parse(socket.sent.at(-1))).toEqual(expect.objectContaining({
      action: "stop",
      turnScopeId: "turn-stop",
      sessionId: "s-1",
    }));
    expect(onStopConfirmationTimeout).not.toHaveBeenCalled();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1000);
    await flushPromises();

    expect(socket.readyState).toBe(MockWebSocket.OPEN);
    expect(onStopConfirmationTimeout).toHaveBeenCalledTimes(1);
    expect(onStopConfirmationTimeout).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "s-1",
      turnScopeId: "turn-stop",
    }));
    await rejectionExpectation;
    expect(settled).toBe(true);

    socket.emit(StreamEventEnum.USER_STOPPED, {
      sessionId: "s-1",
      turnScopeId: "turn-stop",
    });
    expect(settled).toBe(true);
  });

  it("does not let a stale stop timeout finalize a later continue stream", async () => {
    const client = createChatWebSocketClient({
      resolveWebSocketUrl: () => "ws://test",
      stopConfirmationTimeoutMs: 1000,
    });
    client.connect();
    const socket = MockWebSocket.instances[0];
    const onStopConfirmationTimeout = vi.fn();
    let continueSettled = false;

    client.stream({
      action: "chat",
      sessionId: "s-1",
      dialogProcessId: "dp-stop",
      turnScopeId: "turn-stop",
    }, vi.fn());
    expect(client.requestStop({
      sessionId: "s-1",
      dialogProcessId: "dp-stop",
      turnScopeId: "turn-stop",
    }, onStopConfirmationTimeout)).toBe(true);

    const continuePromise = client.stream({
      action: "continue",
      sessionId: "s-1",
      dialogProcessId: "dp-continue",
      turnScopeId: "turn-continue",
    }, vi.fn()).then(() => {
      continueSettled = true;
    });

    await vi.advanceTimersByTimeAsync(1000);
    await flushPromises();

    expect(onStopConfirmationTimeout).not.toHaveBeenCalled();
    expect(socket.readyState).toBe(MockWebSocket.OPEN);
    expect(continueSettled).toBe(false);

    socket.emit(StreamEventEnum.DONE, {
      sessionId: "s-1",
      dialogProcessId: "dp-continue",
      turnScopeId: "turn-continue",
    });
    await continuePromise;
    expect(continueSettled).toBe(true);
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

  it("repeat requestStop keeps stop state and sends latest stop payload", () => {
    const client = createChatWebSocketClient({
      resolveWebSocketUrl: () => "ws://test",
    });
    client.connect();
    const socket = MockWebSocket.instances[0];

    expect(client.requestStop({ turnScopeId: "turn-1" }, vi.fn())).toBe(true);
    expect(client.requestStop({ turnScopeId: "turn-1", partialAssistant: { content: "partial" } }, vi.fn())).toBe(true);

    const stopMessages = socket.sent
      .map((item) => JSON.parse(item))
      .filter((item) => item.action === "stop");
    expect(stopMessages).toHaveLength(2);
    expect(stopMessages.at(-1)).toEqual(expect.objectContaining({
      action: "stop",
      turnScopeId: "turn-1",
      partialAssistant: { content: "partial" },
    }));
    expect(client.isStopRequested()).toBe(true);
    expect(client.getStopRequestedTurnScopeId()).toBe("turn-1");
  });

  it.each(["cancelled"])(
    "resolves after %s terminal channel_state",
    async (state) => {
      const client = createChatWebSocketClient({
        resolveWebSocketUrl: () => "ws://test",
        terminalChannelStateGraceMs: 20,
      });
      client.connect();
      const socket = MockWebSocket.instances[0];
      let resolved = false;

      const streamPromise = client.stream({ action: "chat" }, vi.fn()).then(() => {
        resolved = true;
      });

      socket.emit(StreamEventEnum.CHANNEL_STATE, {
        sessionId: "s-1",
        dialogProcessId: "dp-1",
        state,
        seq: 2,
      });

      await vi.advanceTimersByTimeAsync(20);
      await streamPromise;
      expect(resolved).toBe(true);
    },
  );

  it("keeps DONE as the immediate stream terminator", async () => {
    const client = createChatWebSocketClient({
      resolveWebSocketUrl: () => "ws://test",
      terminalChannelStateGraceMs: 1000,
    });
    client.connect();
    const socket = MockWebSocket.instances[0];
    let resolved = false;

    const streamPromise = client.stream({ action: "chat" }, vi.fn()).then(() => {
      resolved = true;
    });

    socket.emit(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-1",
      state: "completed",
      seq: 2,
    });
    socket.emit(StreamEventEnum.DONE, {
      sessionId: "s-1",
      dialogProcessId: "dp-1",
      seq: 3,
    });

    await streamPromise;
    expect(resolved).toBe(true);
  });

  it("delivers ERROR events before rejecting", async () => {
    const client = createChatWebSocketClient({
      resolveWebSocketUrl: () => "ws://test",
      terminalChannelStateGraceMs: 20,
      translateText: (key) => key,
    });
    client.connect();
    const socket = MockWebSocket.instances[0];
    const onEvent = vi.fn();

    const streamPromise = client.stream({ action: "chat" }, onEvent);
    const errorData = { error: "boom", sessionId: "s-1", dialogProcessId: "dp-1", seq: 4 };
    socket.emit(StreamEventEnum.ERROR, errorData);

    await expect(streamPromise).rejects.toThrow("boom");
    expect(onEvent).toHaveBeenCalledWith({ event: StreamEventEnum.ERROR, data: errorData });
    expect(client.getLastReceivedSeqMap()).toEqual({ "dp-1": 4 });
    socket.close(1011, "server_error");
  });

  it.each([
    [StreamEventEnum.DONE, { turnScopeId: "doc-turn", dialogProcessId: "doc-dp" }],
    [StreamEventEnum.USER_STOPPED, { turnScopeId: "doc-turn", dialogProcessId: "doc-dp" }],
    [StreamEventEnum.ERROR, { turnScopeId: "doc-turn", dialogProcessId: "doc-dp", error: "doc2data failed" }],
    [StreamEventEnum.CHANNEL_STATE, { turnScopeId: "doc-turn", dialogProcessId: "doc-dp", state: "user_stopped" }],
  ])("does not settle current stream for unrelated %s events", async (event, data) => {
    const client = createChatWebSocketClient({
      resolveWebSocketUrl: () => "ws://test",
      terminalChannelStateGraceMs: 20,
      translateText: (key) => key,
    });
    client.connect();
    const socket = MockWebSocket.instances[0];
    let settled = false;

    const streamPromise = client
      .stream({ action: "chat", turnScopeId: "main-turn", dialogProcessId: "main-dp" }, vi.fn())
      .then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );

    socket.emit(event, { sessionId: "s-1", seq: 10, ...data });
    await vi.advanceTimersByTimeAsync(50);
    await Promise.resolve();

    expect(settled).toBe(false);

    socket.emit(StreamEventEnum.DONE, {
      sessionId: "s-1",
      turnScopeId: "main-turn",
      dialogProcessId: "main-dp",
      seq: 11,
    });
    await streamPromise;
    expect(settled).toBe(true);
  });

  it("still settles stream for matching turn terminal events", async () => {
    const client = createChatWebSocketClient({
      resolveWebSocketUrl: () => "ws://test",
      terminalChannelStateGraceMs: 20,
    });
    client.connect();
    const socket = MockWebSocket.instances[0];
    let resolved = false;

    const streamPromise = client
      .stream({ action: "chat", turnScopeId: "main-turn", dialogProcessId: "main-dp" }, vi.fn())
      .then(() => {
        resolved = true;
      });

    socket.emit(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      turnScopeId: "main-turn",
      dialogProcessId: "main-dp",
      state: "user_stopped",
      seq: 12,
    });
    await vi.advanceTimersByTimeAsync(20);

    await streamPromise;
    expect(resolved).toBe(true);
  });

  it.each([
    [StreamEventEnum.USER_STOPPED, { turnScopeId: "main-turn", dialogProcessId: "main-dp" }],
    [StreamEventEnum.CHANNEL_STATE, { turnScopeId: "main-turn", dialogProcessId: "main-dp", state: "user_stopped" }],
  ])("cancels stop confirmation timeout after matching %s stop confirmation", async (event, data) => {
    const client = createChatWebSocketClient({
      resolveWebSocketUrl: () => "ws://test",
      stopConfirmationTimeoutMs: 1000,
      terminalChannelStateGraceMs: 20,
    });
    client.connect();
    const socket = MockWebSocket.instances[0];
    const onStopConfirmationTimeout = vi.fn();
    let resolved = false;

    const streamPromise = client
      .stream({ action: "chat", turnScopeId: "main-turn", dialogProcessId: "main-dp" }, vi.fn())
      .then(() => {
        resolved = true;
      });

    expect(client.requestStop({ turnScopeId: "main-turn", dialogProcessId: "main-dp" }, onStopConfirmationTimeout)).toBe(true);
    socket.emit(event, { sessionId: "s-1", seq: 12, ...data });
    if (event === StreamEventEnum.CHANNEL_STATE) {
      await vi.advanceTimersByTimeAsync(20);
    }
    await streamPromise;

    await vi.advanceTimersByTimeAsync(1000);
    expect(resolved).toBe(true);
    expect(onStopConfirmationTimeout).not.toHaveBeenCalled();
  });
});
