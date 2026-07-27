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

describe("chatWebSocketClient stop requests and confirmation", () => {
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
