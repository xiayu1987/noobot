/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dispatchTurnEnvelope,
  TURN_PROJECTION_SOURCE,
} from "../../../../../../src/modules/chat/runtime/engine/turnProjectionStore.js";
import { setThinkingReplayDebugLogSink } from "../../../../../../src/modules/debug/loggers/thinkingReplayDebugLogger.js";
import { canonicalMessageEvent } from "../../helpers/messageEventFixture.js";
import { buildViewMessage } from "../../../../../../src/modules/chat/model/messageModel.js";
import { normalizeTurnTransportEnvelope } from "../../../../../../src/modules/chat/runtime/engine/turnTransportEnvelope.js";

const identity = { sessionId: "session-1", turnScopeId: "turn-1" };
const message = () =>
  buildViewMessage(
    { ...identity, role: "assistant", presentationMessageId: "message-1" },
    { sessionId: "session-1" },
  );
const envelope = (overrides) =>
  canonicalMessageEvent({
    sessionId: identity.sessionId,
    turnScopeId: identity.turnScopeId,
    presentationMessageId: "message-1",
    occurredAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  });
const events = [
  envelope({ eventId: "evt-1", eventType: "thinking", sequence: 1, text: "hello " }),
  envelope({
    eventId: "evt-2",
    eventType: "tool_call_start",
    sequence: 2,
    tool: "read_file",
    toolCallId: "call-1",
    args: { path: "README.md" },
  }),
  envelope({
    eventId: "evt-3",
    eventType: "tool_call_end",
    sequence: 3,
    tool: "read_file",
    toolCallId: "call-1",
    result: { ok: true },
    success: true,
  }),
  envelope({ eventId: "evt-4", eventType: "llm_delta", sequence: 4, text: "world" }),
];

afterEach(() => setThinkingReplayDebugLogSink(null));

function replay(targetMessage, replayEvents, source) {
  replayEvents.forEach((event) => {
    expect(
      dispatchTurnEnvelope({
        targetMessage,
        envelope: event,
        source,
      }).applied,
    ).toBe(true);
  });
  return targetMessage;
}

function projection(messageValue) {
  const stableTimeline = (timeline = []) =>
    timeline.map((item) => ({
      ...item,
      ...(item.call
        ? {
            call: {
              ...item.call,
              ...(item.call.log ? { log: { ...item.call.log, ts: "<volatile>" } } : {}),
            },
          }
        : {}),
      ...(item.resultEvent
        ? {
            resultEvent: {
              ...item.resultEvent,
              ...(item.resultEvent.log
                ? { log: { ...item.resultEvent.log, ts: "<volatile>" } }
                : {}),
            },
          }
        : {}),
    }));
  return {
    content: messageValue.content,
    toolTimeline: stableTimeline(messageValue.toolTimeline),
    activityTimeline: stableTimeline(messageValue.activityTimeline),
    lastSequence: messageValue.messageEventState.lastSequence,
    consumedEventIds: messageValue.messageEventState.consumedEventIds,
  };
}

describe("turnProjectionStore convergence", () => {
  it("logs canonical envelope identity and payload presence at the shared reducer boundary", () => {
    const debug = vi.fn((_debugType, factory) => factory());
    setThinkingReplayDebugLogSink({ debug, isEnabled: () => true });
    const event = envelope({
      eventId: "guidance-1",
      eventType: "thinking",
      presentationMessageId: "message-1",
      sequence: 1,
      sequenceDomain: "message-event",
      sequenceScopeId: "message-1",
      authority: "authoritative",
      text: "analysis",
    });

    expect(
      dispatchTurnEnvelope({
        targetMessage: message(),
        envelope: event,
        source: TURN_PROJECTION_SOURCE.RECONNECT_LIVE,
      }).applied,
    ).toBe(true);

    expect(debug).toHaveBeenCalledWith("thinking-replay", expect.any(Function));
    expect(debug.mock.results[0].value).toEqual(
      expect.objectContaining({
        event: "frontend.turnProjection.envelopeObserved",
        data: expect.objectContaining({
          source: TURN_PROJECTION_SOURCE.RECONNECT_LIVE,
          protocolFamily: "message.timeline",
          protocolVersion: 3,
          eventId: "guidance-1",
          presentationMessageId: "message-1",
          sequenceDomain: "message-event",
          sequenceScopeId: "message-1",
          authority: "authoritative",
          eventTimestamp: "2026-01-01T00:00:00.000Z",
          reducerObservedAt: expect.any(String),
          sourceToReducerLatencyMs: expect.any(Number),
          result: "applied",
        }),
      }),
    );
  });

  it("returns a stable structured observation contract", () => {
    const target = message();
    const result = dispatchTurnEnvelope({
      targetMessage: target,
      envelope: events[0],
      source: TURN_PROJECTION_SOURCE.NORMAL_LIVE,
    });
    expect(result).toMatchObject({
      requestedSessionId: "session-1",
      canonicalSessionId: "session-1",
      eventId: "evt-1",
      sequence: 1,
      source: TURN_PROJECTION_SOURCE.NORMAL_LIVE,
      authority: "authoritative",
      applied: true,
      reason: "applied",
      messageEffect: "none",
    });
    expect(result.turnKey).toBeTruthy();
  });

  it("rejects an invalid presentation identity at the transport entry", () => {
    const invalid = envelope({
      presentationMessageId: "",
      eventId: "invalid-presentation",
      eventType: "llm_delta",
      sequence: 3,
      text: "must not buffer",
    });
    const normalized = normalizeTurnTransportEnvelope({
      event: invalid.identity.eventType,
      data: invalid,
    });
    expect(normalized.protocolEnvelope).toBeNull();
    expect(normalized.rejected).toEqual({ errors: ["missing_ordering_scope"] });
  });

  it("converges for live and full history replay", () => {
    const live = replay(message(), events, TURN_PROJECTION_SOURCE.NORMAL_LIVE);
    const history = replay(message(), events, TURN_PROJECTION_SOURCE.HISTORY_REPLAY);

    expect(projection(history)).toEqual(projection(live));
  });

  it("buffers a gap and deterministically replays it after the missing event", () => {
    const target = message();
    replay(target, events.slice(0, 1), TURN_PROJECTION_SOURCE.RECONNECT_LIVE);
    expect(
      dispatchTurnEnvelope({
        targetMessage: target,
        envelope: events[2],
        source: TURN_PROJECTION_SOURCE.RECONNECT_LIVE,
      }),
    ).toMatchObject({
      applied: false,
      result: "sequence_gap",
      expectedSequence: 2,
      receivedSequence: 3,
    });
    replay(target, events.slice(1, 2), TURN_PROJECTION_SOURCE.RECONNECT_LIVE);
    expect(target.messageEventState.lastSequence).toBe(3);
    expect(target.toolTimeline).toHaveLength(1);
    expect(target.toolTimeline[0]).toMatchObject({ status: "completed" });
  });
});
