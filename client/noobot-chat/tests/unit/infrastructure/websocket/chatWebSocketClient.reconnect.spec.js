/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { createChatWebSocketClient } from "../../../../src/infrastructure/websocket/chatWebSocketClient.js";
import { StreamEventEnum } from "../../../../src/modules/chat/model/chatConstants.js";
import { MESSAGE_EVENT_WIRE_EVENT } from "@noobot/event-protocol/message-event";
import { createExecutionQueryEnvelope } from "@noobot/event-protocol/execution-query";
import {
  EXECUTION_QUERY_COMMAND,
  EXECUTION_SNAPSHOT_WIRE_EVENT,
  deriveAgentExecutionId,
} from "@noobot/session-protocol";
import {
  AGENT_COMMAND,
  AGENT_COMMAND_RECEIPT_OUTCOME,
  AGENT_TRANSPORT_EVENT,
  AGENT_TRANSPORT_ERROR_CODE,
  createAgentCommandReceipt,
  createAgentTransportError,
  createExecutionQueryCommand,
} from "@noobot/agent-transport-protocol";
import { canonicalMessageEvent } from "../../modules/chat/helpers/messageEventFixture.js";
import {
  MockWebSocket,
  emitReconnectComplete,
  setupWebSocketTestHooks,
  streamCommand,
} from "./chatWebSocketClientTestFixtures.js";

setupWebSocketTestHooks();

function emitCompletedCommand(socket, commandId, sessionId, turnScopeId) {
  socket.emit(
    AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT,
    createAgentCommandReceipt({
      commandId,
      commandType: AGENT_COMMAND.SEND,
      outcome: AGENT_COMMAND_RECEIPT_OUTCOME.COMPLETED,
      identity: { sessionId, turnScopeId },
      occurredAt: "2026-01-01T00:00:00.000Z",
    }),
  );
}

function messageEvent(overrides = {}) {
  return canonicalMessageEvent({
    eventType: "llm_delta",
    presentationMessageId: "stream-message",
    text: "",
    ...overrides,
  });
}

describe("chatWebSocketClient reconnect and event dispatch", () => {
  it("reuses the bootstrap socket for the initial reconnect handshake", async () => {
    const client = createChatWebSocketClient({
      resolveWebSocketUrl: () => "ws://test",
    });
    client.connect();
    const bootstrapSocket = MockWebSocket.instances[0];

    const reconnectPromise = client.reconnect({
      identity: { sessionId: "s-1", parentSessionId: "", parentDialogProcessId: "" },
      knownLifecycleSequenceMap: { "s-1": 12 },
      onReconnectData: vi.fn(),
    });

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(bootstrapSocket.sent).toHaveLength(1);
    expect(JSON.parse(bootstrapSocket.sent[0])).toMatchObject({
      action: "reconnect",
      identity: { sessionId: "s-1" },
      knownLifecycleSequenceMap: { "s-1": 12 },
    });
    emitReconnectComplete(bootstrapSocket, 0);
    await reconnectPromise;
  });

  it("keeps restored-session live events subscribed after reconnect completes", async () => {
    const onReconnectData = vi.fn();
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    const reconnectPromise = client.reconnect({
      identity: { sessionId: "s-live-replay", parentSessionId: "", parentDialogProcessId: "" },
      knownLifecycleSequenceMap: {},
      onReconnectData,
    });
    const socket = MockWebSocket.instances[0];
    socket.onopen?.();

    emitReconnectComplete(socket, 1);
    await reconnectPromise;
    const thinkingEvent = canonicalMessageEvent({
      eventId: "thinking-live-replay",
      eventType: "thinking",
      sessionId: "s-live-replay",
      turnScopeId: "turn-live-replay",
      presentationMessageId: "message-live-replay",
      sequence: 2,
      text: "continued thinking",
    });
    const contentEvent = canonicalMessageEvent({
      eventId: "content-live-replay",
      eventType: "llm_delta",
      sessionId: "s-live-replay",
      turnScopeId: "turn-live-replay",
      presentationMessageId: "message-live-replay",
      sequence: 3,
      text: "continued answer",
    });
    socket.emit(MESSAGE_EVENT_WIRE_EVENT, thinkingEvent);
    socket.emit(MESSAGE_EVENT_WIRE_EVENT, contentEvent);

    expect(onReconnectData).toHaveBeenNthCalledWith(1, {
      event: MESSAGE_EVENT_WIRE_EVENT,
      data: thinkingEvent,
    });
    expect(onReconnectData).toHaveBeenNthCalledWith(2, {
      event: MESSAGE_EVENT_WIRE_EVENT,
      data: contentEvent,
    });
  });

  it("rejects a failed reconnect transaction without closing the shared transport", async () => {
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    const reconnectPromise = client.reconnect({
      identity: { sessionId: "s-failed-reconnect", parentSessionId: "", parentDialogProcessId: "" },
      knownLifecycleSequenceMap: {},
    });
    const socket = MockWebSocket.instances[0];

    socket.emit(
      AGENT_TRANSPORT_EVENT.ERROR,
      createAgentTransportError({
        code: AGENT_TRANSPORT_ERROR_CODE.RECONNECT_FAILED,
        message: "reconnect failed",
        identity: { sessionId: "s-failed-reconnect" },
      }),
    );

    await expect(reconnectPromise).rejects.toMatchObject({
      message: "reconnect failed",
      code: AGENT_TRANSPORT_ERROR_CODE.RECONNECT_FAILED,
    });
    expect(socket.readyState).toBe(MockWebSocket.OPEN);
  });

  it("delivers child canonical live events with a business requestId while reconnect replay is running", async () => {
    const onReconnectData = vi.fn();
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    const reconnectPromise = client.reconnect({
      identity: { sessionId: "root-session", parentSessionId: "", parentDialogProcessId: "" },
      knownLifecycleSequenceMap: {},
      onReconnectData,
    });
    const socket = MockWebSocket.instances[0];
    socket.onopen?.();
    const reconnectRequestId = JSON.parse(socket.sent[0]).requestId;
    const childEventData = canonicalMessageEvent({
      eventId: "evt-child-tool-start",
      eventType: "tool_call_start",
      sessionId: "child-session",
      turnScopeId: "workflow-node:node-1",
      presentationMessageId: "child-message",
      sequence: 1,
      parentSessionId: "root-session",
      workflowRunId: "workflow-1",
      nodeExecutionId: "node-1",
      toolCallId: "call-1",
      tool: "read_file",
    });
    childEventData.causality.commandId = "stream:original-business-turn";

    socket.emit(MESSAGE_EVENT_WIRE_EVENT, childEventData);

    expect(onReconnectData).toHaveBeenCalledWith({
      event: MESSAGE_EVENT_WIRE_EVENT,
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
      identity: { sessionId: "root-session", parentSessionId: "", parentDialogProcessId: "" },
      knownLifecycleSequenceMap: {},
      onReconnectData: vi.fn(),
    });
    const socket = MockWebSocket.instances[0];
    socket.onopen?.();

    socket.emit(
      MESSAGE_EVENT_WIRE_EVENT,
      canonicalMessageEvent({
        eventId: "child-tool-99",
        eventType: "tool_call_start",
        sessionId: "child-session",
        turnScopeId: "workflow-node:node-1",
        presentationMessageId: "child-message",
        sequence: 99,
        parentSessionId: "root-session",
        workflowRunId: "workflow-1",
        nodeExecutionId: "node-1",
        toolCallId: "call-99",
        tool: "read_file",
      }),
    );

    emitReconnectComplete(socket, 1);
    await reconnectPromise;
  });

  it("does not duplicate live events while an active stream owns the turn", async () => {
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    const onStreamEvent = vi.fn();
    const onReconnectData = vi.fn();
    const streamPromise = client.stream(
      streamCommand({
        sessionId: "s-live-owner",
        turnScopeId: "turn-live-owner",
      }),
      onStreamEvent,
    );
    const socket = MockWebSocket.instances[0];
    const streamRequestId = JSON.parse(socket.sent[0]).commandId;
    const reconnectPromise = client.reconnect({
      identity: { sessionId: "s-live-owner", parentSessionId: "", parentDialogProcessId: "" },
      knownLifecycleSequenceMap: {},
      onReconnectData,
    });

    emitReconnectComplete(socket, 1);
    await reconnectPromise;
    const ownedEvent = messageEvent({
      eventId: "owned-message",
      sessionId: "s-live-owner",
      turnScopeId: "turn-live-owner",
      text: "owned by stream",
    });
    socket.emit(MESSAGE_EVENT_WIRE_EVENT, ownedEvent);

    expect(onStreamEvent).toHaveBeenCalledWith({
      event: MESSAGE_EVENT_WIRE_EVENT,
      data: ownedEvent,
    });
    expect(onReconnectData).not.toHaveBeenCalled();

    emitCompletedCommand(socket, streamRequestId, "s-live-owner", "turn-live-owner");
    await streamPromise;
  });

  it("routes run events to the active stream while reconnect control is still in flight", async () => {
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    const onStreamEvent = vi.fn();
    const onReconnectData = vi.fn();
    const streamPromise = client.stream(
      {
        commandType: "turn.resend",
        commandId: "turn-overlap",
        identity: { sessionId: "s-overlap", turnScopeId: "turn-overlap" },
      },
      onStreamEvent,
    );
    const socket = MockWebSocket.instances[0];
    const reconnectPromise = client.reconnect({
      identity: { sessionId: "s-overlap", parentSessionId: "", parentDialogProcessId: "" },
      knownLifecycleSequenceMap: {},
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
    const overlapMessage = messageEvent({
      eventId: "overlap-message",
      sessionId: "s-overlap",
      turnScopeId: "turn-overlap",
      text: "run is active",
    });
    socket.emit(MESSAGE_EVENT_WIRE_EVENT, overlapMessage);

    expect(onStreamEvent).toHaveBeenCalledWith({
      event: StreamEventEnum.TURN_LIFECYCLE,
      data: expect.objectContaining({ eventType: "turn.action_accepted" }),
    });
    expect(onStreamEvent).toHaveBeenCalledWith({
      event: MESSAGE_EVENT_WIRE_EVENT,
      data: overlapMessage,
    });
    expect(onReconnectData).not.toHaveBeenCalled();

    socket.emit(StreamEventEnum.RECONNECT_COMPLETE, {
      requestId: reconnectRequestId,
      totalSessions: 1,
    });
    await reconnectPromise;
    expect(onStreamEvent).toHaveBeenCalledTimes(2);

    emitCompletedCommand(socket, "turn-overlap", "s-overlap", "turn-overlap");
    await streamPromise;
  });

  it("multiplexes reconnect on the active stream socket without opening another connection", async () => {
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    const onEvent = vi.fn();
    const streamPromise = client.stream(
      streamCommand({ sessionId: "s-1", turnScopeId: "turn-1" }),
      onEvent,
    );
    const socket = MockWebSocket.instances[0];
    const streamRequestId = JSON.parse(socket.sent[0]).commandId;

    const reconnectPromise = client.reconnect({
      identity: { sessionId: "s-1", parentSessionId: "", parentDialogProcessId: "" },
      knownLifecycleSequenceMap: {},
    });
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(JSON.parse(socket.sent[1])).toMatchObject({
      action: "reconnect",
      identity: { sessionId: "s-1" },
    });
    expect(JSON.parse(socket.sent[1])).not.toHaveProperty("currentTurnScopeId");
    emitReconnectComplete(socket, 1);
    await reconnectPromise;
    emitCompletedCommand(socket, streamRequestId, "s-1", "turn-1");

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
    const streamPromise = client.stream(
      streamCommand({ sessionId: "s-1", turnScopeId: "turn-1" }),
      onEvent,
    );
    const streamRequestId = JSON.parse(streamSocket.sent[0]).commandId;
    streamSocket.readyState = MockWebSocket.CLOSING;

    const reconnectPromise = client.reconnect({
      identity: { sessionId: "s-1", parentSessionId: "", parentDialogProcessId: "" },
      knownLifecycleSequenceMap: {},
      onReconnectData: vi.fn(),
    });
    const reconnectSocket = MockWebSocket.instances[1];
    expect(MockWebSocket.instances).toHaveLength(2);
    reconnectSocket.onopen?.();
    emitReconnectComplete(reconnectSocket, 1);
    await reconnectPromise;

    expect(streamSocket.readyState).toBe(MockWebSocket.CLOSED);
    expect(reconnectSocket.readyState).toBe(MockWebSocket.OPEN);
    const continuedEvent = messageEvent({
      eventId: "continued-message",
      sessionId: "s-1",
      turnScopeId: "turn-1",
      text: "continued",
    });
    reconnectSocket.emit(MESSAGE_EVENT_WIRE_EVENT, continuedEvent);
    emitCompletedCommand(reconnectSocket, streamRequestId, "s-1", "turn-1");
    await expect(streamPromise).resolves.toBeUndefined();
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: MESSAGE_EVENT_WIRE_EVENT,
        data: continuedEvent,
      }),
    );
  });

  it("keeps the permanent transport dispatcher on a replacement socket", async () => {
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    const streamPromise = client.stream(
      streamCommand({ sessionId: "s-1", turnScopeId: "turn-1" }),
      vi.fn(),
    );
    const firstSocket = MockWebSocket.instances[0];
    const streamRequestId = JSON.parse(firstSocket.sent[0]).commandId;
    firstSocket.readyState = MockWebSocket.CLOSING;
    const reconnectPromise = client.reconnect({
      identity: { sessionId: "s-1", parentSessionId: "", parentDialogProcessId: "" },
      knownLifecycleSequenceMap: {},
    });
    const replacementSocket = MockWebSocket.instances[1];

    replacementSocket.onopen?.();
    emitReconnectComplete(replacementSocket, 1);
    await reconnectPromise;
    replacementSocket.emit("transport_ready", { serverInstanceId: "proxy-after-reconnect" });

    expect(client.getTransportStatus().serverInstanceId).toBe("proxy-after-reconnect");
    emitCompletedCommand(replacementSocket, streamRequestId, "s-1", "turn-1");
    await streamPromise;
  });

  it("resolves command responses through the permanent dispatcher after reconnect", async () => {
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    const streamPromise = client.stream(
      streamCommand({ sessionId: "s-1", turnScopeId: "turn-1" }),
      vi.fn(),
    );
    const firstSocket = MockWebSocket.instances[0];
    const streamRequestId = JSON.parse(firstSocket.sent[0]).commandId;
    firstSocket.readyState = MockWebSocket.CLOSING;
    const reconnectPromise = client.reconnect({
      identity: { sessionId: "s-1", parentSessionId: "", parentDialogProcessId: "" },
      knownLifecycleSequenceMap: {},
    });
    const replacementSocket = MockWebSocket.instances[1];

    replacementSocket.onopen?.();
    emitReconnectComplete(replacementSocket, 1);
    await reconnectPromise;
    const executionId = deriveAgentExecutionId({ turnScopeId: "turn-1" });
    const commandPromise = client.requestJson(
      createExecutionQueryCommand({
        commandType: EXECUTION_QUERY_COMMAND.SNAPSHOT_GET,
        commandId: "snapshot-after-reconnect",
        identity: { sessionId: "s-1" },
        query: { executionId, rootExecutionId: "" },
      }),
      { expectedEvents: [EXECUTION_SNAPSHOT_WIRE_EVENT] },
    );
    const envelope = createExecutionQueryEnvelope({
      wireEvent: EXECUTION_SNAPSHOT_WIRE_EVENT,
      commandId: "snapshot-after-reconnect",
      executionId,
      payload: {
        execution: {
          executionId,
          executionKind: "agent",
          parentExecutionId: "",
          rootExecutionId: executionId,
          sessionId: "s-1",
          turnScopeId: "turn-1",
          sequence: 1,
          revision: 1,
        },
      },
      occurredAt: "2026-10-17T00:00:00.000Z",
    });
    replacementSocket.emit(EXECUTION_SNAPSHOT_WIRE_EVENT, envelope);

    await expect(commandPromise).resolves.toEqual({
      event: EXECUTION_SNAPSHOT_WIRE_EVENT,
      data: envelope,
    });
    emitCompletedCommand(replacementSocket, streamRequestId, "s-1", "turn-1");
    await streamPromise;
  });

  it("delivers replayed errors without rejecting reconnect", async () => {
    const onReconnectData = vi.fn();
    const client = createChatWebSocketClient({
      resolveWebSocketUrl: () => "ws://test",
    });
    const reconnectPromise = client.reconnect({
      identity: { sessionId: "s-1", parentSessionId: "", parentDialogProcessId: "" },
      knownLifecycleSequenceMap: {},
      onReconnectData,
    });
    const socket = MockWebSocket.instances[0];

    socket.onopen?.();
    const errorData = createAgentTransportError({
      code: "replayed_failure",
      message: "failed attempt",
      identity: { sessionId: "s-1", dialogProcessId: "dp-failed" },
      occurredAt: "2026-01-01T00:00:00.000Z",
    });
    socket.emit(AGENT_TRANSPORT_EVENT.ERROR, errorData);
    emitReconnectComplete(socket, 1);

    await expect(reconnectPromise).resolves.toEqual({
      requestId: JSON.parse(socket.sent[0]).requestId,
      totalSessions: 1,
    });
    expect(onReconnectData).toHaveBeenCalledWith({
      event: AGENT_TRANSPORT_EVENT.ERROR,
      data: errorData,
    });
  });
});
