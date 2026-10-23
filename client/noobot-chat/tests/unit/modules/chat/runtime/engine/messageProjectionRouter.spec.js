/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setTransportDiagnosticsLogSink } from "../../../../../../src/modules/debug/loggers/transportDiagnosticsLogger.js";
import { routeMessageProjectionEvent } from "../../../../../../src/modules/chat/runtime/engine/messageProjectionRouter.js";
import { hydrateTurnSnapshot } from "../../../../../../src/modules/chat/runtime/engine/turnProjectionStore.js";
import { canonicalMessageEvent } from "../../helpers/messageEventFixture.js";
import { EVENT_FAMILY } from "@noobot/event-protocol";

const finalEvent = (overrides = {}) =>
  canonicalMessageEvent({
    eventId: "event-final-1",
    eventType: "authoritative_final_content",
    sessionId: "session-1",
    presentationMessageId: "assistant-message-1",
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
    sequence: 1,
    occurredAt: "2026-07-28T16:00:00.000Z",
    text: "final answer",
    ...overrides,
  });

function contextFor(messages, logSessionEvent = vi.fn()) {
  return {
    channelSessionId: "session-1",
    findMessagesByPresentationId(sessionId, presentationMessageId) {
      return messages.filter(
        (message) =>
          message.sessionId === sessionId &&
          message.presentationMessageId === presentationMessageId,
      );
    },
    materializeTurnPresentation: vi.fn(),
    reduceSubSessionMessageEvent: vi.fn(),
    logSessionEvent,
    navigateOnFirstResponseOnce: vi.fn(),
  };
}

describe("live canonical message projection", () => {
  let diagnostics = [];
  beforeEach(() => {
    diagnostics = [];
    setTransportDiagnosticsLogSink({
      isEnabled: (type) => type === "transport-diagnostics",
      debug: (_debugType, factory) => diagnostics.push(factory()) > 0,
    });
  });
  afterEach(() => setTransportDiagnosticsLogSink(null));

  it("leaves non message timeline families to later routes without diagnostics", () => {
    const logSessionEvent = vi.fn();

    expect(routeMessageProjectionEvent(null, "", contextFor([], logSessionEvent))).toBe(false);

    expect(logSessionEvent).not.toHaveBeenCalled();
    expect(diagnostics).toHaveLength(0);
  });

  it("rejects a split presentation identity without creating a second assistant entity", () => {
    const messages = [
      {
        presentationMessageId: "assistant-message-1",
        sessionId: "session-1",
        turnScopeId: "turn-1",
        role: "assistant",
        content: "",
      },
    ];
    const logSessionEvent = vi.fn();
    const mismatched = finalEvent({
      eventId: "event-split-identity",
      presentationMessageId: "unexpected-assistant-message",
    });

    expect(
      routeMessageProjectionEvent(
        mismatched,
        EVENT_FAMILY.MESSAGE_TIMELINE,
        contextFor(messages, logSessionEvent),
      ),
    ).toBe(true);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      presentationMessageId: "assistant-message-1",
      content: "",
    });
    expect(logSessionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "frontend.messageEvent.reduced",
        level: "warn",
        data: expect.objectContaining({
          presentationMessageId: "unexpected-assistant-message",
          reductions: [],
          target: { found: false },
        }),
      }),
    );
  });

  it("does not project a child authority message into the root channel Session", () => {
    const messages = [
      {
        presentationMessageId: "assistant-message-1",
        sessionId: "session-1",
        turnScopeId: "turn-1",
        role: "assistant",
        content: "",
      },
    ];
    const logSessionEvent = vi.fn();
    const childEvent = finalEvent({
      eventId: "child-event",
      sessionId: "child-session",
      turnScopeId: "child-turn",
    });

    expect(
      routeMessageProjectionEvent(
        childEvent,
        EVENT_FAMILY.MESSAGE_TIMELINE,
        contextFor(messages, logSessionEvent),
      ),
    ).toBe(true);

    expect(messages[0].content).toBe("");
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        event: "frontend.messageEvent.routeEvaluated",
        data: expect.objectContaining({ ownedByChannel: false }),
      }),
    );
    expect(diagnostics.map(({ event }) => event)).not.toContain(
      "frontend.messageEvent.presentationMaterialized",
    );
    expect(logSessionEvent).not.toHaveBeenCalled();
  });

  it("keeps the canonical entity set identical after live completion and snapshot hydration", () => {
    const messages = [
      {
        presentationMessageId: "assistant-message-1",
        sessionId: "session-1",
        turnScopeId: "turn-1",
        role: "assistant",
        content: "",
      },
    ];
    const context = contextFor(messages);

    expect(routeMessageProjectionEvent(finalEvent(), EVENT_FAMILY.MESSAGE_TIMELINE, context)).toBe(
      true,
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      presentationMessageId: "assistant-message-1",
      content: "final answer",
    });
    expect(context.logSessionEvent).not.toHaveBeenCalled();
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        event: "frontend.messageEvent.targetResolved",
        data: expect.objectContaining({
          eventId: "event-final-1",
          target: expect.objectContaining({ found: true, contentLength: 0 }),
        }),
      }),
    );
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        event: "frontend.messageEvent.reduced",
        data: expect.objectContaining({
          reductions: [{ result: "applied", errors: undefined }],
          target: expect.objectContaining({ found: true, contentLength: 12 }),
        }),
      }),
    );

    const idsBeforeRefresh = messages.map(({ messageId }) => messageId);
    const hydration = hydrateTurnSnapshot({
      targetMessage: messages[0],
      snapshot: {
        presentationMessageId: "assistant-message-1",
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
