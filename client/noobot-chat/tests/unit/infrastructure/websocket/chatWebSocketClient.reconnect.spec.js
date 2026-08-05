/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { createChatWebSocketClient } from "../../../../src/infrastructure/websocket/chatWebSocketClient.js";
import { StreamEventEnum } from "../../../../src/modules/chat/model/chatConstants.js";
import { flushPromises, MockWebSocket, setupWebSocketTestHooks } from "./chatWebSocketClientTestFixtures.js";

setupWebSocketTestHooks();

describe("chatWebSocketClient reconnect and event dispatch", () => {
  it("reuses the bootstrap socket for the initial reconnect handshake", async () => {
    const client = createChatWebSocketClient({
      resolveWebSocketUrl: () => "ws://test",
    });
    client.connect();
    const bootstrapSocket = MockWebSocket.instances[0];

    const reconnectPromise = client.reconnect({
      currentSessionId: "s-1",
      userId: "u-1",
      knownLifecycleSequenceMap: { "s-1": 12 },
      onReconnectData: vi.fn(),
    });

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(bootstrapSocket.sent).toHaveLength(1);
    expect(JSON.parse(bootstrapSocket.sent[0])).toMatchObject({
      action: "reconnect",
      currentSessionId: "s-1",
      userId: "u-1",
      knownLifecycleSequenceMap: { "s-1": 12 },
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
    socket.emit("message", {
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
      event: "message",
      data: expect.objectContaining({ text: "continued thinking", seq: 2 }),
    });
    expect(onReconnectData).toHaveBeenNthCalledWith(2, {
      event: StreamEventEnum.DELTA,
      data: expect.objectContaining({ content: "continued answer", seq: 3 }),
    });
  });

  it("delivers child canonical live events with a business requestId while reconnect replay is running", async () => {
    const onReconnectData = vi.fn();
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    const reconnectPromise = client.reconnect({
      currentSessionId: "root-session",
      userId: "u-1",
      onReconnectData,
    });
    const socket = MockWebSocket.instances[0];
    socket.onopen?.();
    const reconnectRequestId = JSON.parse(socket.sent[0]).requestId;
    const childEventData = {
      requestId: "stream:original-business-turn",
      sessionId: "child-session",
      dialogProcessId: "child-dialog",
      turnScopeId: "workflow-node:node-1",
      seq: 42,
      event: {
        eventId: "evt-child-tool-start",
        type: "tool_call_start",
        sequence: 1,
      },
    };

    socket.emit("subagent_message_event", childEventData);

    expect(onReconnectData).toHaveBeenCalledWith({
      event: "subagent_message_event",
      data: childEventData,
    });

    socket.emit(StreamEventEnum.RECONNECT_COMPLETE, {
      requestId: reconnectRequestId,
      totalSessions: 1,
    });
    await reconnectPromise;
  });

  it("does not use an inner message-event sequence as the reconnect transport cursor", async () => {
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    const reconnectPromise = client.reconnect({
      currentSessionId: "root-session",
      onReconnectData: vi.fn(),
    });
    const socket = MockWebSocket.instances[0];

    socket.emit("subagent_message_event", {
      sessionId: "child-session",
      dialogProcessId: "child-dialog",
      turnScopeId: "workflow-node:node-1",
      event: { type: "tool_call_start", sequence: 99 },
    });

    socket.emit(StreamEventEnum.RECONNECT_COMPLETE, { totalSessions: 1 });
    await reconnectPromise;
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

  it("routes run events to the active stream while reconnect control is still in flight", async () => {
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    const onStreamEvent = vi.fn();
    const onReconnectData = vi.fn();
    const streamPromise = client.stream({
      commandType: "turn.resend",
      commandId: "turn-overlap",
      identity: { sessionId: "s-overlap", turnScopeId: "turn-overlap" },
    }, onStreamEvent);
    const socket = MockWebSocket.instances[0];
    const reconnectPromise = client.reconnect({
      currentSessionId: "s-overlap",
      userId: "u-1",
      onReconnectData,
    });
    const reconnectRequestId = JSON.parse(socket.sent[1]).requestId;

    socket.emit(StreamEventEnum.TURN_LIFECYCLE, {
      eventId: "lifecycle-overlap-1",
      eventType: "turn.action_accepted",
      sessionId: "s-overlap",
      turnScopeId: "turn-overlap",
      revision: 1,
      sequence: 1,
    });
    socket.emit(StreamEventEnum.DELTA, {
      sessionId: "s-overlap",
      turnScopeId: "turn-overlap",
      content: "run is active",
    });

    expect(onStreamEvent).toHaveBeenCalledWith({
      event: StreamEventEnum.TURN_LIFECYCLE,
      data: expect.objectContaining({ eventType: "turn.action_accepted" }),
    });
    expect(onStreamEvent).toHaveBeenCalledWith({
      event: StreamEventEnum.DELTA,
      data: expect.objectContaining({ content: "run is active" }),
    });
    expect(onReconnectData).not.toHaveBeenCalled();

    socket.emit(StreamEventEnum.RECONNECT_COMPLETE, {
      requestId: reconnectRequestId,
      totalSessions: 1,
    });
    await reconnectPromise;
    expect(onStreamEvent).toHaveBeenCalledTimes(2);

    socket.emit(StreamEventEnum.DONE, {
      sessionId: "s-overlap",
      turnScopeId: "turn-overlap",
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
    expect(JSON.parse(socket.sent[1])).toMatchObject({ action: "reconnect", currentSessionId: "s-1" });
    expect(JSON.parse(socket.sent[1])).not.toHaveProperty("currentTurnScopeId");
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
    socket.emit(StreamEventEnum.RECONNECT_COMPLETE, { totalSessions: 1 });

    await expect(reconnectPromise).resolves.toEqual({ totalSessions: 1 });
    expect(onReconnectData).toHaveBeenCalledWith({
      event: StreamEventEnum.ERROR,
      data: errorData,
    });
  });

});
