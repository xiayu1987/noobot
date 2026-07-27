/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { createChatWebSocketClient } from "../../../../src/services/ws/chatWebSocketClient.js";
import { StreamEventEnum } from "../../../../src/shared/constants/chatConstants.js";
import { flushPromises, MockWebSocket, setupWebSocketTestHooks } from "./chatWebSocketClientTestFixtures.js";

setupWebSocketTestHooks();

describe("chatWebSocketClient stream terminal semantics and isolation", () => {
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

});
