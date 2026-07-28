/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { createChatWebSocketClient } from "../../../../src/infrastructure/websocket/chatWebSocketClient.js";
import { StreamEventEnum } from "../../../../src/modules/chat/model/chatConstants.js";
import { MockWebSocket, setupWebSocketTestHooks } from "./chatWebSocketClientTestFixtures.js";

setupWebSocketTestHooks();

describe("chatWebSocketClient stop transport", () => {
  it("sends the supplied stop command without owning its lifecycle", async () => {
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    client.connect();
    const socket = MockWebSocket.instances[0];
    let resolved = false;
    const streamPromise = client.stream({
      action: "chat",
      sessionId: "s-1",
      dialogProcessId: "main-dp",
      turnScopeId: "main-turn",
    }, vi.fn()).then(() => {
      resolved = true;
    });

    expect(client.requestStop({
      commandId: "stop:main-turn",
      sessionId: "s-1",
      dialogProcessId: "main-dp",
      turnScopeId: "main-turn",
    })).toBe(true);
    expect(JSON.parse(socket.sent.at(-1))).toEqual({
      action: "stop",
      commandId: "stop:main-turn",
      sessionId: "s-1",
      dialogProcessId: "main-dp",
      turnScopeId: "main-turn",
    });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(resolved).toBe(false);

    socket.emit(StreamEventEnum.USER_STOPPED, {
      sessionId: "s-1",
      dialogProcessId: "main-dp",
      turnScopeId: "main-turn",
    });
    await streamPromise;
    expect(resolved).toBe(true);
  });

  it("returns false when no open transport can send the command", () => {
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });

    expect(client.requestStop({ commandId: "stop:turn-1", turnScopeId: "turn-1" })).toBe(false);
    expect(client.isStopRequested).toBeUndefined();
    expect(client.getStopRequestedTurnScopeId).toBeUndefined();
    expect(client.clearStopRequested).toBeUndefined();
  });

  it("closes a connecting transport and reports that stop was not sent", () => {
    MockWebSocket.initialReadyState = MockWebSocket.CONNECTING;
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    client.connect();
    const socket = MockWebSocket.instances[0];

    expect(client.requestStop({ commandId: "stop:turn-1", turnScopeId: "turn-1" })).toBe(false);
    expect(socket.readyState).toBe(MockWebSocket.CLOSED);
  });

  it("keeps repeated idempotent stop commands as transport sends", () => {
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    client.connect();
    const socket = MockWebSocket.instances[0];

    expect(client.requestStop({ commandId: "stop:turn-1", turnScopeId: "turn-1" })).toBe(true);
    expect(client.requestStop({
      commandId: "stop:turn-1",
      turnScopeId: "turn-1",
      partialAssistant: { content: "partial" },
    })).toBe(true);

    const stopMessages = socket.sent.map((item) => JSON.parse(item));
    expect(stopMessages).toHaveLength(2);
    expect(stopMessages.at(-1)).toEqual({
      action: "stop",
      commandId: "stop:turn-1",
      turnScopeId: "turn-1",
      partialAssistant: { content: "partial" },
    });
  });
});
