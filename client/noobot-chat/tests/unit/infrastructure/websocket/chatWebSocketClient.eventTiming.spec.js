/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatWebSocketClient } from "../../../../src/infrastructure/websocket/chatWebSocketClient.js";
import { setEventProcessingTimingLogSink } from "../../../../src/modules/debug/loggers/eventProcessingTimingLogger.js";
import {
  MockWebSocket,
  setupWebSocketTestHooks,
  streamCommand,
} from "./chatWebSocketClientTestFixtures.js";
import { MESSAGE_EVENT_WIRE_EVENT } from "@noobot/event-protocol/message-event";
import { canonicalMessageEvent } from "../../modules/chat/helpers/messageEventFixture.js";

setupWebSocketTestHooks();

function emitAssistantContent(socket) {
  socket.emit(
    MESSAGE_EVENT_WIRE_EVENT,
    canonicalMessageEvent({
      eventId: "event-timing",
      eventType: "authoritative_final_content",
      sessionId: "session-timing",
      dialogProcessId: "dialog-timing",
      turnScopeId: "turn-timing",
      messageId: "message-timing",
      sequence: 1,
      content: "assistant body",
    }),
  );
}

describe("chatWebSocketClient event processing timing", () => {
  afterEach(() => {
    setEventProcessingTimingLogSink(null);
    vi.unstubAllGlobals();
  });

  it("does not measure or schedule frames when timing diagnostics are disabled", () => {
    const debug = vi.fn();
    const requestAnimationFrame = vi.fn();
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    setEventProcessingTimingLogSink({ debug, isEnabled: () => false });
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    void client.stream(
      streamCommand({ sessionId: "session-timing", turnScopeId: "turn-timing" }),
      vi.fn(),
    );

    emitAssistantContent(MockWebSocket.instances[0]);

    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(debug).not.toHaveBeenCalled();
  });

  it("records queue, dispatch and next-frame durations keyed by eventId", () => {
    const frames = [];
    vi.stubGlobal("requestAnimationFrame", (callback) => frames.push(callback));
    const debug = vi.fn((debugType, factory) => factory());
    setEventProcessingTimingLogSink({
      debug,
      isEnabled: (type) => type === "event-processing-timing",
    });
    const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
    void client.stream(
      streamCommand({ sessionId: "session-timing", turnScopeId: "turn-timing" }),
      vi.fn(),
    );

    emitAssistantContent(MockWebSocket.instances[0]);

    expect(debug).not.toHaveBeenCalled();
    expect(frames).toHaveLength(1);
    frames[0]();
    const record = debug.mock.results[0].value;
    expect(record).toEqual(
      expect.objectContaining({
        debugType: "event-processing-timing",
        event: "frontend.websocket.eventProcessingTiming",
        sessionId: "session-timing",
        turnScopeId: "turn-timing",
      }),
    );
    expect(record.data).toEqual(
      expect.objectContaining({
        eventId: "event-timing",
        protocolEvent: MESSAGE_EVENT_WIRE_EVENT,
        owner: "stream_handler",
        dispatchMs: expect.any(Number),
        nextFrameMs: expect.any(Number),
      }),
    );
    expect(record.data).toHaveProperty("queueDelayMs");
  });
});
