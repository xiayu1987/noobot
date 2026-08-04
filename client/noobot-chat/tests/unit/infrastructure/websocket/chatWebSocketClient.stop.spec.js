/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { createChatWebSocketClient } from "../../../../src/infrastructure/websocket/chatWebSocketClient.js";
import { StreamEventEnum } from "../../../../src/modules/chat/model/chatConstants.js";
import { MockWebSocket, setupWebSocketTestHooks } from "./chatWebSocketClientTestFixtures.js";
import { createTurnStopCommand } from "@noobot/agent-transport-protocol";

function stopCommand({
  commandId = "stop:main-turn",
  sessionId = "s-1",
  dialogProcessId = "main-dp",
  turnScopeId = "main-turn",
  partialAssistant,
} = {}) {
  return createTurnStopCommand({
    commandId,
    identity: { sessionId, dialogProcessId, turnScopeId },
    concurrency: {},
    stop: { partialAssistant },
  });
}

setupWebSocketTestHooks();

describe("chatWebSocketClient stop transport", () => {
  it("resolves the stop command only after its authoritative lifecycle acknowledgement", async () => {
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

    const command = stopCommand();
    const stopPromise = client.requestStop(command);
    expect(JSON.parse(socket.sent.at(-1))).toEqual(command);

    await vi.advanceTimersByTimeAsync(10000);
    expect(resolved).toBe(false);

    socket.emit(StreamEventEnum.TURN_LIFECYCLE, {
      commandId: "stop:main-turn",
      sessionId: "s-1",
      dialogProcessId: "main-dp",
      turnScopeId: "main-turn",
      state: "action_requesting",
    });
    await expect(stopPromise).resolves.toBe(true);

    socket.emit(StreamEventEnum.USER_STOPPED, {
      sessionId: "s-1",
      dialogProcessId: "main-dp",
      turnScopeId: "main-turn",
    });
    await streamPromise;
    expect(resolved).toBe(true);
  });

  it("rejects when no open transport can send the command", async () => {
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });

    await expect(client.requestStop(stopCommand({ commandId: "stop:turn-1", turnScopeId: "turn-1" }))).rejects.toThrow();
    expect(client.isStopRequested).toBeUndefined();
    expect(client.getStopRequestedTurnScopeId).toBeUndefined();
    expect(client.clearStopRequested).toBeUndefined();
  });

  it("rejects a stop command while the transport is still connecting", async () => {
    MockWebSocket.initialReadyState = MockWebSocket.CONNECTING;
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    client.connect();
    const socket = MockWebSocket.instances[0];

    await expect(client.requestStop(stopCommand({ commandId: "stop:turn-1", turnScopeId: "turn-1" }))).rejects.toThrow();
    expect(socket.readyState).toBe(MockWebSocket.CONNECTING);
  });

  it("rejects a duplicate stop command while its authoritative acknowledgement is pending", async () => {
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    client.connect();
    const socket = MockWebSocket.instances[0];

    const firstCommand = stopCommand({ commandId: "stop:turn-1", turnScopeId: "turn-1" });
    const first = client.requestStop(firstCommand);
    await expect(client.requestStop(stopCommand({
      commandId: "stop:turn-1",
      turnScopeId: "turn-1",
      partialAssistant: { content: "partial" },
    }))).rejects.toThrow("commandId request already pending");

    const stopMessages = socket.sent.map((item) => JSON.parse(item));
    expect(stopMessages).toHaveLength(1);
    expect(stopMessages[0]).toEqual(firstCommand);
    socket.emit(StreamEventEnum.TURN_LIFECYCLE, {
      commandId: "stop:turn-1",
      turnScopeId: "turn-1",
      state: "action_requesting",
    });
    await expect(first).resolves.toBe(true);
  });
});
