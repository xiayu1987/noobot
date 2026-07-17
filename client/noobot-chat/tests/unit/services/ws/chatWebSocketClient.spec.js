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

  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.OPEN;
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
    }));

    socket.emit(StreamEventEnum.RECONNECT_COMPLETE, { totalSessions: 0, cacheExpired: false });
    await reconnectPromise;
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

    expect(socket.sent.map((item) => JSON.parse(item))).toContainEqual({
      action: "continue",
      turnScopeId: "turn-continue",
    });
    expect(onPayloadSent).toHaveBeenCalledTimes(1);
    expect(onPayloadSent).toHaveBeenCalledWith({
      action: "continue",
      turnScopeId: "turn-continue",
    });

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
