/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { classifyRealtimeLog } from "../../../../../src/app/state/sessionMessageState";
import {
  dispatchTurnEnvelope,
  hydrateTurnSnapshot,
  TURN_PROJECTION_SOURCE,
} from "../../../../../src/composables/chat/chatEngine/turnProjectionStore";

const identity = { sessionId: "session-1", turnScopeId: "turn-1" };
const message = () => ({ ...identity, id: "message-1", messageId: "message-1", content: "" });
const envelope = (overrides) => ({
  envelopeKind: "noobot.message_event",
  envelopeVersion: 1,
  sessionId: identity.sessionId,
  turnScopeId: identity.turnScopeId,
  messageId: "message-1",
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
});
