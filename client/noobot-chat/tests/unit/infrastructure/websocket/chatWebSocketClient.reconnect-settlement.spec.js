/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { ROOT_PARENT_SESSION_ID } from "@noobot/agent-transport-protocol";
import { createChatWebSocketClient } from "../../../../src/infrastructure/websocket/chatWebSocketClient.js";
import {
  MockWebSocket,
  emitReconnectComplete,
  setupWebSocketTestHooks,
} from "./chatWebSocketClientTestFixtures.js";

setupWebSocketTestHooks();

function reconnect(client, onReconnectData = vi.fn()) {
  return client.reconnect({
    identity: { sessionId: "s-1", parentSessionId: ROOT_PARENT_SESSION_ID },
    knownLifecycleSequenceMap: {},
    onReconnectData,
  });
}

describe("chatWebSocketClient reconnect settlement", () => {
  it.each([MockWebSocket.CONNECTING, MockWebSocket.OPEN])(
    "rejects a pending reconnect on disposal at readyState %s",
    async (readyState) => {
      MockWebSocket.initialReadyState = readyState;
      const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
      const pending = reconnect(client);
      const rejected = expect(pending).rejects.toThrow("websocket_client_disposed");
      const socket = MockWebSocket.instances[0];
      const lateOpen = socket.onopen;
      const sentBeforeDisposal = socket.sent.length;

      client.dispose();
      await rejected;
      lateOpen();
      client.dispose();
      expect(socket.sent).toHaveLength(sentBeforeDisposal);
      expect(socket.readyState).toBe(MockWebSocket.CLOSED);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("rejects a concurrent reconnect without interrupting the active transaction", async () => {
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    const pending = reconnect(client);
    await expect(reconnect(client)).rejects.toThrow("infra.reconnectInProgress");
    const socket = MockWebSocket.instances[0];
    socket.onopen();
    emitReconnectComplete(socket, 0);
    await expect(pending).resolves.toMatchObject({ totalSessions: 0 });
    client.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("settles timeout once and ignores old socket events during the next reconnect", async () => {
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    const onReconnectData = vi.fn();
    const pending = reconnect(client, onReconnectData);
    const rejected = expect(pending).rejects.toThrow("infra.reconnectTimeout");
    const oldSocket = MockWebSocket.instances[0];
    oldSocket.onopen();
    const lateOpen = oldSocket.onopen;
    const lateMessage = oldSocket.onmessage;
    const oldControl = JSON.parse(oldSocket.sent[0]);

    await vi.advanceTimersByTimeAsync(TIME_THRESHOLDS.client.wsReconnectTimeoutMs);
    await rejected;
    expect(oldSocket.readyState).toBe(MockWebSocket.CLOSED);
    expect(vi.getTimerCount()).toBe(0);

    const next = reconnect(client, onReconnectData);
    lateOpen();
    lateMessage({
      data: JSON.stringify({
        event: "reconnect_complete",
        data: { requestId: oldControl.requestId, totalSessions: 0 },
      }),
    });
    expect(oldSocket.sent).toHaveLength(1);
    expect(onReconnectData).not.toHaveBeenCalled();
    const nextSocket = MockWebSocket.instances[1];
    nextSocket.onopen();
    emitReconnectComplete(nextSocket, 0);
    await expect(next).resolves.toMatchObject({ totalSessions: 0 });
    client.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
