/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyRealtimeLog } from "../../../../../../src/app/state/sessionMessageState.js";
import {
  dispatchTurnEnvelope,
  hydrateTurnSnapshot,
  TURN_PROJECTION_SOURCE,
} from "../../../../../../src/modules/chat/runtime/engine/turnProjectionStore.js";
import {
  setThinkingReplayDebugLogSink,
} from "../../../../../../src/modules/debug/loggers/thinkingReplayDebugLogger.js";

const identity = { sessionId: "session-1", turnScopeId: "turn-1" };
const message = () => ({ ...identity, id: "message-1", messageId: "message-1", content: "" });
const envelope = (overrides) => ({
  envelopeKind: "noobot.message_event",
  envelopeVersion: 2,
  sessionId: identity.sessionId,
  turnScopeId: identity.turnScopeId,
  messageId: "message-1",
  presentationMessageId: "message-1",
  timestamp: "2026-01-01T00:00:00.000Z",
  ...overrides,
});
const events = [
  envelope({ eventId: "evt-1", eventType: "llm_delta", sequence: 1, text: "hello " }),
  envelope({
    eventId: "evt-2", eventType: "tool_call_start", sequence: 2,
    tool: "read_file", toolCallId: "call-1", args: { path: "README.md" },
  }),
  envelope({
    eventId: "evt-3", eventType: "tool_call_end", sequence: 3,
    tool: "read_file", toolCallId: "call-1", result: { ok: true },
  }),
  envelope({ eventId: "evt-4", eventType: "llm_delta", sequence: 4, text: "world" }),
];

afterEach(() => setThinkingReplayDebugLogSink(null));

function replay(targetMessage, replayEvents, source) {
  replayEvents.forEach((event) => {
    expect(dispatchTurnEnvelope({
      targetMessage,
      envelope: event,
      classifyRealtimeLog,
      source,
    }).applied).toBe(true);
  });
  return targetMessage;
}

function projection(messageValue) {
  const stableTimeline = (timeline = []) => timeline.map((item) => ({
    ...item,
    ...(item.call ? {
      call: { ...item.call, ...(item.call.log ? { log: { ...item.call.log, ts: "<volatile>" } } : {}) },
    } : {}),
    ...(item.resultEvent ? {
      resultEvent: {
        ...item.resultEvent,
        ...(item.resultEvent.log ? { log: { ...item.resultEvent.log, ts: "<volatile>" } } : {}),
      },
    } : {}),
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
    const debug = vi.fn((debugType, factory) => factory());
    setThinkingReplayDebugLogSink({ debug, isEnabled: () => true });
    const event = envelope({
      envelopeVersion: 2,
      envelopeKind: "noobot.message_event",
      eventId: "guidance-1",
      eventType: "thinking",
      presentationMessageId: "message-1",
      sequence: 1,
      sequenceDomain: "message-event",
      sequenceScopeId: "message-1",
      authority: "authoritative",
      text: "analysis",
      output: "analysis",
    });

    expect(dispatchTurnEnvelope({
      targetMessage: message(),
      envelope: event,
      classifyRealtimeLog,
      source: TURN_PROJECTION_SOURCE.RECONNECT_LIVE,
    }).applied).toBe(true);

    expect(debug).toHaveBeenCalledWith("thinking-replay", expect.any(Function));
    expect(debug.mock.results[0].value).toEqual(expect.objectContaining({
      event: "frontend.turnProjection.envelopeObserved",
      data: expect.objectContaining({
        source: TURN_PROJECTION_SOURCE.RECONNECT_LIVE,
        envelopeKind: "noobot.message_event",
        envelopeVersion: 2,
        eventId: "guidance-1",
        messageId: "message-1",
        presentationMessageId: "message-1",
        sequenceDomain: "message-event",
        sequenceScopeId: "message-1",
        authority: "authoritative",
        textLength: 8,
        outputLength: 8,
        eventTimestamp: "2026-01-01T00:00:00.000Z",
        reducerObservedAt: expect.any(String),
        sourceToReducerLatencyMs: expect.any(Number),
        result: "applied",
      }),
    }));
  });

  it("returns a stable structured observation contract", () => {
    const target = message();
    const result = dispatchTurnEnvelope({
      targetMessage: target,
      envelope: events[0],
      classifyRealtimeLog,
      source: TURN_PROJECTION_SOURCE.NORMAL_LIVE,
    });
    expect(result).toMatchObject({
      requestedSessionId: "session-1",
      canonicalSessionId: "session-1",
      eventId: "evt-1",
      sequence: 1,
      source: TURN_PROJECTION_SOURCE.NORMAL_LIVE,
      authority: "none",
      applied: true,
      reason: "applied",
      aliasPromoted: false,
      messageEffect: "none",
    });
    expect(result.turnKey).toBeTruthy();
  });

  it("rejects an invalid v2 presentation identity before buffering sequence state", () => {
    const target = message();
    const result = dispatchTurnEnvelope({
      targetMessage: target,
      envelope: envelope({
        envelopeVersion: 2,
        presentationMessageId: "",
        eventId: "invalid-v2",
        eventType: "llm_delta",
        sequence: 3,
        text: "must not buffer",
      }),
      classifyRealtimeLog,
      source: TURN_PROJECTION_SOURCE.RECONNECT_LIVE,
    });
    expect(result).toMatchObject({
      applied: false,
      result: "invalid",
      reason: "invalid_message_event_envelope",
    });
    expect(target).not.toHaveProperty("messageEventState");
  });

  it("converges for live, snapshot plus reconnect increment, and full history replay", () => {
    const live = replay(message(), events, TURN_PROJECTION_SOURCE.NORMAL_LIVE);

    const snapshotBase = replay(message(), events.slice(0, 2), TURN_PROJECTION_SOURCE.NORMAL_LIVE);
    const snapshot = structuredClone(snapshotBase);
    snapshot.throughSequence = 2;
    const reconnected = message();
    expect(hydrateTurnSnapshot({ targetMessage: reconnected, snapshot }).applied).toBe(true);
    replay(reconnected, events.slice(2), TURN_PROJECTION_SOURCE.RECONNECT_LIVE);

    const history = replay(message(), events, TURN_PROJECTION_SOURCE.HISTORY_REPLAY);

    expect(projection(reconnected)).toEqual(projection(live));
    expect(projection(history)).toEqual(projection(live));
  });

  it("buffers a gap and deterministically replays it after the missing event", () => {
    const target = message();
    replay(target, events.slice(0, 1), TURN_PROJECTION_SOURCE.RECONNECT_LIVE);
    expect(dispatchTurnEnvelope({
      targetMessage: target,
      envelope: events[2],
      classifyRealtimeLog,
      source: TURN_PROJECTION_SOURCE.RECONNECT_LIVE,
    })).toMatchObject({ applied: false, result: "sequence_gap", expectedSequence: 2, receivedSequence: 3 });
    replay(target, events.slice(1, 2), TURN_PROJECTION_SOURCE.RECONNECT_LIVE);
    expect(target.messageEventState.lastSequence).toBe(3);
    expect(target.toolTimeline).toHaveLength(1);
    expect(target.toolTimeline[0]).toMatchObject({ status: "completed" });
  });

  it("aggregates explicit source-message lanes into one presentation message", () => {
    const target = {
      ...identity,
      id: "optimistic-turn-message",
      messageId: "optimistic-turn-message",
      content: "",
    };
    const multiMessageEvents = [
      envelope({
        messageId: "assistant-tools-1", eventId: "tools-1-start-a",
        eventType: "tool_call_start", sequence: 1,
        timestamp: "2026-01-01T00:00:01.000Z",
        tool: "read_file", toolCallId: "call-a", args: {},
      }),
      envelope({
        messageId: "assistant-tools-1", eventId: "tools-1-start-b",
        eventType: "tool_call_start", sequence: 2,
        timestamp: "2026-01-01T00:00:02.000Z",
        tool: "read_file", toolCallId: "call-b", args: {},
      }),
      envelope({
        messageId: "assistant-tools-1", eventId: "tools-1-end-a",
        eventType: "tool_call_end", sequence: 3,
        timestamp: "2026-01-01T00:00:03.000Z",
        tool: "read_file", toolCallId: "call-a", result: { ok: true },
      }),
      envelope({
        messageId: "assistant-tools-1", eventId: "tools-1-end-b",
        eventType: "tool_call_end", sequence: 4,
        timestamp: "2026-01-01T00:00:04.000Z",
        tool: "read_file", toolCallId: "call-b", result: { ok: true },
      }),
      envelope({
        messageId: "assistant-tools-2", eventId: "tools-2-start",
        eventType: "tool_call_start", sequence: 1,
        timestamp: "2026-01-01T00:00:05.000Z",
        tool: "write_file", toolCallId: "call-c", args: {},
      }),
      envelope({
        messageId: "assistant-tools-2", eventId: "tools-2-end",
        eventType: "tool_call_end", sequence: 2,
        timestamp: "2026-01-01T00:00:06.000Z",
        tool: "write_file", toolCallId: "call-c", result: { ok: true },
      }),
      envelope({
        messageId: "assistant-final", eventId: "final-content",
        eventType: "authoritative_final_content", sequence: 1,
        timestamp: "2026-01-01T00:00:07.000Z",
        text: "finished", output: "finished",
      }),
    ];
    multiMessageEvents.forEach((eventItem) => {
      eventItem.envelopeVersion = 2;
      eventItem.presentationMessageId = "optimistic-turn-message";
    });

    const results = multiMessageEvents.map((eventItem) => dispatchTurnEnvelope({
      targetMessage: target,
      envelope: eventItem,
      classifyRealtimeLog,
      source: TURN_PROJECTION_SOURCE.NORMAL_LIVE,
    }));

    expect(results.every((result) => result.applied === true)).toBe(true);
    expect(target.content).toBe("finished");
    expect(target.toolTimeline || []).toHaveLength(3);
    expect(Object.keys(target.messageEventState.sequenceLanesByScopeId)).toEqual([
      "assistant-tools-1", "assistant-tools-2", "assistant-final",
    ]);
    expect(target.messageEventState.consumedEventIds).toHaveLength(7);
  });

  it("hydrates idempotently, replays buffered increments, and excludes Turn UI state", () => {
    const target = message();
    replay(target, events.slice(0, 1), TURN_PROJECTION_SOURCE.RECONNECT_LIVE);
    expect(dispatchTurnEnvelope({
      targetMessage: target,
      envelope: events[2],
      classifyRealtimeLog,
      source: TURN_PROJECTION_SOURCE.RECONNECT_LIVE,
    }).reason).toBe("sequence_gap");
    const snapshotBase = replay(message(), events.slice(0, 2), TURN_PROJECTION_SOURCE.HISTORY_REPLAY);
    const snapshot = {
      ...structuredClone(snapshotBase),
      throughSequence: 2,
      thinkingOpenNames: ["must-not-hydrate"],
      expandedDetailLogKeys: ["must-not-hydrate"],
    };

    expect(hydrateTurnSnapshot({ targetMessage: target, snapshot })).toMatchObject({
      applied: true,
      reason: "snapshot_accepted",
    });
    expect(target.messageEventState.lastSequence).toBe(3);
    expect(target.toolTimeline[0]).toMatchObject({ status: "completed" });
    expect(target).not.toHaveProperty("thinkingOpenNames");
    expect(target).not.toHaveProperty("expandedDetailLogKeys");

    const once = projection(structuredClone(target));
    expect(hydrateTurnSnapshot({ targetMessage: target, snapshot: structuredClone(target), throughSequence: 3 }).applied).toBe(true);
    expect(projection(target)).toEqual(once);
  });

  it("preserves local image preview metadata when an accepted snapshot adds parsed output", () => {
    const target = {
      ...message(),
      attachments: [{
        attachmentId: "image-1",
        name: "diagram.png",
        mimeType: "image/png",
        size: 123,
        previewUrl: "blob:http://localhost/image-1",
      }],
    };
    const snapshot = {
      ...message(),
      throughSequence: 1,
      attachments: [{
        attachmentId: "image-1",
        name: "diagram.png",
        mimeType: "image/png",
        size: 123,
        parsedResult: { attachmentId: "parsed-1", mimeType: "text/markdown" },
      }],
    };

    expect(hydrateTurnSnapshot({ targetMessage: target, snapshot })).toMatchObject({
      applied: true,
      reason: "snapshot_accepted",
    });
    expect(target.attachments).toEqual([
      expect.objectContaining({
        attachmentId: "image-1",
        previewUrl: "blob:http://localhost/image-1",
        parsedResult: expect.objectContaining({ attachmentId: "parsed-1" }),
      }),
    ]);
  });
});
