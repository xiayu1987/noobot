/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { createChatWebSocketClient } from "../../../../src/infrastructure/websocket/chatWebSocketClient.js";
import { StreamEventEnum } from "../../../../src/modules/chat/model/chatConstants.js";
import {
  AGENT_COMMAND_RECEIPT_OUTCOME,
  AGENT_TRANSPORT_EVENT,
  createAgentCommandReceipt,
} from "@noobot/agent-transport-protocol";
import {
  emitCommandReceipt,
  MockWebSocket,
  setupWebSocketTestHooks,
  streamCommand,
} from "./chatWebSocketClientTestFixtures.js";

setupWebSocketTestHooks();

function startScopedStream(client, overrides = {}, onEvent = vi.fn()) {
  const payload = streamCommand({
    sessionId: "s-1",
    dialogProcessId: "main-dp",
    turnScopeId: "main-turn",
    ...overrides,
  });
  return { payload, onEvent, promise: client.stream(payload, onEvent) };
}

describe("chatWebSocketClient stream terminal semantics and isolation", () => {
  it("does not resolve from channel_state and resolves only from the matching command receipt", async () => {
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    const { payload, promise } = startScopedStream(client);
    const socket = MockWebSocket.instances[0];
    let resolved = false;
    promise.then(() => { resolved = true; });

    socket.emit(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "main-dp",
      turnScopeId: "main-turn",
      state: "completed",
      seq: 2,
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(resolved).toBe(false);

    emitCommandReceipt(socket, payload);
    await promise;
    expect(resolved).toBe(true);
  });

  it("does not resolve stream for non-terminal channel_state", async () => {
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    const { payload, promise } = startScopedStream(client);
    const socket = MockWebSocket.instances[0];
    let settled = false;
    promise.finally(() => { settled = true; });

    socket.emit(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "main-dp",
      turnScopeId: "main-turn",
      state: "sending",
      seq: 1,
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(false);

    emitCommandReceipt(socket, payload);
    await promise;
  });

  it("does not settle a scoped stream from an unscoped no_conversation prelude", async () => {
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    const onEvent = vi.fn();
    const { payload, promise } = startScopedStream(client, {}, onEvent);
    const socket = MockWebSocket.instances[0];
    let resolved = false;
    promise.then(() => { resolved = true; });

    socket.emit(StreamEventEnum.CHANNEL_STATE, { sessionId: "s-1", state: "no_conversation", seq: 0 });
    await vi.advanceTimersByTimeAsync(30);
    expect(resolved).toBe(false);

    emitCommandReceipt(socket, payload);
    await promise;
    expect(resolved).toBe(true);
  });

  it("delivers a failed command receipt before rejecting", async () => {
    const client = createChatWebSocketClient({
      resolveWebSocketUrl: () => "ws://test",
      translateText: (key) => key,
    });
    const onEvent = vi.fn();
    const { payload, promise } = startScopedStream(client, {}, onEvent);
    const socket = MockWebSocket.instances[0];
    const receipt = emitCommandReceipt(socket, payload, {
      outcome: AGENT_COMMAND_RECEIPT_OUTCOME.FAILED,
      error: { code: "stream_failed", message: "boom" },
    });

    await expect(promise).rejects.toThrow("boom");
    expect(onEvent).toHaveBeenCalledWith({
      event: AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT,
      data: receipt,
    });
  });

  it("does not settle the current stream from an unrelated command receipt", async () => {
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    const { payload, promise } = startScopedStream(client);
    const socket = MockWebSocket.instances[0];
    let settled = false;
    promise.finally(() => { settled = true; });

    socket.emit(AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT, createAgentCommandReceipt({
      commandId: "test-stream:unrelated-turn",
      commandType: payload.commandType,
      outcome: AGENT_COMMAND_RECEIPT_OUTCOME.COMPLETED,
      identity: { sessionId: "s-1", turnScopeId: "unrelated-turn", dialogProcessId: "doc-dp" },
      occurredAt: "2026-01-01T00:00:00.000Z",
    }));
    await vi.advanceTimersByTimeAsync(50);
    expect(settled).toBe(false);

    emitCommandReceipt(socket, payload);
    await promise;
    expect(settled).toBe(true);
  });
});
