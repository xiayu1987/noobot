/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { createChatWebSocketClient } from "../../../../src/infrastructure/websocket/chatWebSocketClient.js";
import {
  MockWebSocket,
  emitCommandReceipt,
  setupWebSocketTestHooks,
  streamCommand,
  turnLifecycleProtocolEvent,
} from "./chatWebSocketClientTestFixtures.js";
import { createTurnStopCommand } from "@noobot/agent-transport-protocol";
import {
  createTurnLifecycleEnvelope,
  TURN_EVENT,
  TURN_PHASE,
  TURN_STATE,
} from "@noobot/session-protocol";

function stopCommand({
  commandId = "stop:main-turn",
  sessionId = "s-1",
  dialogProcessId = "main-dp",
  turnScopeId = "main-turn",
  expectedTurnRevision = 2,
  partialAssistant,
} = {}) {
  return createTurnStopCommand({
    commandId,
    identity: { sessionId, dialogProcessId, turnScopeId },
    concurrency: { expectedTurnRevision },
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
    const runCommand = streamCommand({
      sessionId: "s-1",
      dialogProcessId: "main-dp",
      turnScopeId: "main-turn",
    });
    const streamPromise = client.stream(runCommand, vi.fn()).then(() => {
      resolved = true;
    });

    const command = stopCommand();
    const stopPromise = client.requestStop(command);
    expect(JSON.parse(socket.sent.at(-1))).toEqual(command);

    await vi.advanceTimersByTimeAsync(10000);
    expect(resolved).toBe(false);

    socket.emit("turn_lifecycle", turnLifecycleProtocolEvent(createTurnLifecycleEnvelope({
      eventType: TURN_EVENT.STOP_ACCEPTED,
      eventId: "stop-accepted:main-turn",
      commandId: "stop:main-turn",
      sessionId: "s-1",
      dialogProcessId: "main-dp",
      turnScopeId: "main-turn",
      messageId: "assistant:main-turn",
      presentationMessageId: "assistant:main-turn",
      revision: 3,
      sequence: 3,
      phase: TURN_PHASE.STOP,
      state: TURN_STATE.ACTION_REQUESTING,
    })));
    await expect(stopPromise).resolves.toBe(true);

    emitCommandReceipt(socket, runCommand, { outcome: "stopped" });
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
    socket.emit("turn_lifecycle", turnLifecycleProtocolEvent(createTurnLifecycleEnvelope({
      eventType: TURN_EVENT.STOP_ACCEPTED,
      eventId: "stop-accepted:turn-1",
      commandId: "stop:turn-1",
      sessionId: "s-1",
      dialogProcessId: "main-dp",
      turnScopeId: "turn-1",
      messageId: "assistant:turn-1",
      presentationMessageId: "assistant:turn-1",
      revision: 3,
      sequence: 3,
      phase: TURN_PHASE.STOP,
      state: TURN_STATE.ACTION_REQUESTING,
    })));
    await expect(first).resolves.toBe(true);
  });
});
