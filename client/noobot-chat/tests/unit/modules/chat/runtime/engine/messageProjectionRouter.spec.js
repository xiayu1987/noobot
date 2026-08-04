/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { routeMessageProjectionEvent } from "../../../../../../src/modules/chat/runtime/engine/messageProjectionRouter.js";
import { hydrateTurnSnapshot } from "../../../../../../src/modules/chat/runtime/engine/turnProjectionStore.js";

const finalEvent = (overrides = {}) => ({
  envelopeKind: "noobot.message_event",
  envelopeVersion: 2,
  eventId: "event-final-1",
  eventType: "authoritative_final_content",
  sessionId: "session-1",
  messageId: "stream-message-1",
  presentationMessageId: "assistant-message-1",
  dialogProcessId: "dialog-1",
  turnScopeId: "turn-1",
  sequenceDomain: "message-event",
  sequenceScopeId: "stream-message-1",
  sequence: 1,
  timestamp: "2026-07-28T16:00:00.000Z",
  text: "final answer",
  ...overrides,
});

function packet(event) {
  return {
    channelKind: "message_event",
    channelVersion: 1,
    route: { scope: "main_session", sessionId: event.sessionId },
    event,
  };
}

function contextFor(messages, logSessionEvent = vi.fn()) {
  return {
    sessionId: "session-1",
    turnScopeId: "turn-1",
    classifyRealtimeLog: vi.fn(),
    findCanonicalMessageById(sessionId, messageId) {
      return messages.find((message) =>
        message.sessionId === sessionId && message.messageId === messageId) || null;
    },
    logSessionEvent,
    navigateOnFirstResponseOnce: vi.fn(),
    locateSendingStartedMessageOnce: vi.fn(),
  };
}

describe("live canonical message projection", () => {
  it("records ordinary non-message routing decisions as debug diagnostics", () => {
    const logSessionEvent = vi.fn();

    expect(routeMessageProjectionEvent("agent_done", {}, contextFor([], logSessionEvent))).toBe(false);

    expect(logSessionEvent).toHaveBeenCalledOnce();
    expect(logSessionEvent).toHaveBeenCalledWith(expect.objectContaining({
      category: "transport",
      level: "debug",
      event: "frontend.messageEvent.routeEvaluated",
      data: expect.objectContaining({
        channelEvent: "agent_done",
        shouldProjectMain: false,
      }),
    }));
  });

  it("rejects a split presentation identity without creating a second assistant entity", () => {
    const messages = [{
      id: "assistant-message-1",
      messageId: "assistant-message-1",
      sessionId: "session-1",
      turnScopeId: "turn-1",
      role: "assistant",
      content: "",
    }];
    const logSessionEvent = vi.fn();
    const mismatched = finalEvent({
      eventId: "event-split-identity",
      presentationMessageId: "unexpected-assistant-message",
    });

    expect(routeMessageProjectionEvent("message_event", packet(mismatched), contextFor(messages, logSessionEvent))).toBe(true);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ messageId: "assistant-message-1", content: "" });
    expect(logSessionEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: "frontend.messageEvent.reduced",
      level: "warn",
      data: expect.objectContaining({
        presentationMessageId: "unexpected-assistant-message",
        result: "target_missing",
      }),
    }));
  });

  it("keeps the canonical entity set identical after live completion and snapshot hydration", () => {
    const messages = [{
      id: "assistant-message-1",
      messageId: "assistant-message-1",
      sessionId: "session-1",
      turnScopeId: "turn-1",
      role: "assistant",
      content: "",
    }];
    const context = contextFor(messages);

    expect(routeMessageProjectionEvent("message_event", packet(finalEvent()), context)).toBe(true);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      messageId: "assistant-message-1",
      content: "final answer",
    });
    expect(context.logSessionEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: "frontend.messageEvent.targetResolved",
      data: expect.objectContaining({
        eventId: "event-final-1",
        target: expect.objectContaining({ found: true, contentLength: 0 }),
      }),
    }));
    expect(context.logSessionEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: "frontend.messageEvent.reduced",
      data: expect.objectContaining({
        result: "applied",
        targetAfter: expect.objectContaining({ contentLength: 12 }),
      }),
    }));

    const idsBeforeRefresh = messages.map(({ messageId }) => messageId);
    const hydration = hydrateTurnSnapshot({
      targetMessage: messages[0],
      snapshot: {
        id: "assistant-message-1",
        messageId: "assistant-message-1",
        sessionId: "session-1",
        turnScopeId: "turn-1",
        role: "assistant",
        content: "final answer",
        throughSequence: 1,
      },
      throughSequence: 1,
    });

    expect(hydration).toMatchObject({ applied: true, result: "snapshot_accepted" });
    expect(messages.map(({ messageId }) => messageId)).toEqual(idsBeforeRefresh);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("final answer");
  });
});
