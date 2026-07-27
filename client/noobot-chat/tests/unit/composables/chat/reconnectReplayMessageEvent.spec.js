/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { applyReconnectEnvelopeToTargetMessage } from "../../../../src/composables/chat/reconnectReplay/batchReplay.js";
import {
  dispatchTurnEnvelope,
  hydrateTurnSnapshot,
  TURN_PROJECTION_SOURCE,
} from "../../../../src/composables/chat/chatEngine/turnProjectionStore.js";
import { selectToolTimelineLogs } from "../../../../src/composables/chat/chatEngine/toolTimeline.js";
import { selectActivityTimelineLogs } from "../../../../src/composables/chat/chatEngine/activityTimeline.js";

const classify = (event) => ({
  ...event,
  type: event.eventType === "tool_call_start" ? "tool_call" : "tool_result",
  text: event.eventType === "tool_call_start" ? `[tool] ${event.tool}` : "[tool] result",
});

const authoritative = (eventType, sequence, extra = {}) => ({
  event: "message_event",
  sequence,
  data: {
    channelKind: "message_event",
    channelVersion: 1,
    route: { scope: "main_session", sessionId: "session-1" },
    event: {
      envelopeKind: "noobot.message_event",
      envelopeVersion: 1,
      eventId: `event-${sequence}`,
      eventType,
      sessionId: "session-1",
      messageId: "message-1",
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
      sequence,
      timestamp: `2026-07-22T05:00:0${sequence}.000Z`,
      ...extra,
    },
  },
});

describe("reconnect authoritative message event replay", () => {
  it("uses the canonical reducer and consumes no-text tool events idempotently", () => {
    const targetMessage = {
      messageId: "message-1",
      turnScopeId: "turn-1",
      content: "",
    };
    const start = authoritative("tool_call_start", 1, {
      tool: "read_file",
      toolCallId: "call-1",
      args: { filePath: "notes.txt" },
    });
    const end = authoritative("tool_call_end", 2, {
      tool: "read_file",
      toolCallId: "call-1",
      result: { ok: true },
    });

    applyReconnectEnvelopeToTargetMessage({ envelope: start, targetMessage, classifyRealtimeLog: classify });
    applyReconnectEnvelopeToTargetMessage({ envelope: start, targetMessage, classifyRealtimeLog: classify });
    applyReconnectEnvelopeToTargetMessage({ envelope: end, targetMessage, classifyRealtimeLog: classify });

    expect(selectToolTimelineLogs(targetMessage)).toEqual([
      expect.objectContaining({ type: "tool_call", toolCallId: "call-1" }),
      expect.objectContaining({ type: "tool_result", toolCallId: "call-1" }),
    ]);
    expect(targetMessage.toolTimeline).toEqual([
      expect.objectContaining({
        toolCallId: "call-1",
        tool: "read_file",
        status: "completed",
        call: expect.objectContaining({ eventId: "event-1", sequence: 1 }),
        resultEvent: expect.objectContaining({ eventId: "event-2", sequence: 2 }),
      }),
    ]);
    expect(targetMessage.messageEventState).toMatchObject({ lastSequence: 2 });
  });

  it("produces equivalent state for normal live, reconnect live and history replay", () => {
    const events = [
      authoritative("llm_delta", 1, { text: "hello " }),
      authoritative("tool_call_start", 2, {
        tool: "read_file", toolCallId: "call-1", args: { filePath: "notes.txt" },
      }),
      authoritative("tool_call_end", 3, {
        tool: "read_file", toolCallId: "call-1", result: { ok: true },
      }),
      authoritative("llm_delta", 4, { text: "world" }),
    ];
    const createTarget = () => ({ messageId: "message-1", turnScopeId: "turn-1" });
    const normalLive = createTarget();
    const reconnectLive = createTarget();
    const historyReplay = createTarget();

    for (const envelope of events) {
      dispatchTurnEnvelope({
        targetMessage: normalLive,
        envelope: envelope.data.event,
        classifyRealtimeLog: classify,
        source: TURN_PROJECTION_SOURCE.NORMAL_LIVE,
      });
      dispatchTurnEnvelope({
        targetMessage: reconnectLive,
        envelope: envelope.data.event,
        classifyRealtimeLog: classify,
        source: TURN_PROJECTION_SOURCE.RECONNECT_LIVE,
      });
      applyReconnectEnvelopeToTargetMessage({ envelope, targetMessage: historyReplay, classifyRealtimeLog: classify });
    }

    const observableState = ({ content, toolTimeline, activityTimeline, messageEventState }) => ({
      content, toolTimeline, activityTimeline, messageEventState,
    });
    expect(observableState(reconnectLive)).toEqual(observableState(normalLive));
    expect(observableState(historyReplay)).toEqual(observableState(normalLive));
    expect(normalLive).toMatchObject({ content: "hello world" });
    expect(selectToolTimelineLogs(normalLive)).toHaveLength(2);
  });

  it("rejects cross-turn projection even when history target has no session id", () => {
    const targetMessage = { messageId: "message-1", turnScopeId: "turn-stopped" };
    const result = dispatchTurnEnvelope({
      targetMessage,
      envelope: authoritative("llm_delta", 1, { turnScopeId: "turn-continuation", text: "wrong" }).data.event,
      classifyRealtimeLog: classify,
      source: TURN_PROJECTION_SOURCE.HISTORY_REPLAY,
    });

    expect(result.result).toBe("message_identity_conflict");
    expect(targetMessage.content).toBeUndefined();
  });

  it("does not allow an older snapshot boundary to replace newer live projection", () => {
    const targetMessage = { messageId: "message-1", turnScopeId: "turn-1" };
    for (const sequence of [1, 2]) {
      dispatchTurnEnvelope({
        targetMessage,
        envelope: authoritative("llm_delta", sequence, { text: String(sequence) }).data.event,
        classifyRealtimeLog: classify,
      });
    }
    const result = hydrateTurnSnapshot({
      targetMessage,
      snapshot: { sessionId: "session-1", turnScopeId: "turn-1", throughSequence: 1 },
    });

    expect(result).toMatchObject({ applied: false, result: "snapshot_stale", currentSequence: 2 });
    expect(targetMessage.content).toBe("12");
  });

  it("buffers sequence gaps so out-of-order replay converges with ordered live state", () => {
    const ordered = { messageId: "message-1", turnScopeId: "turn-1" };
    const reordered = { messageId: "message-1", turnScopeId: "turn-1" };
    const events = [
      authoritative("llm_delta", 1, { text: "A" }).data.event,
      authoritative("tool_call_start", 2, { tool: "read_file", toolCallId: "call-1", args: {} }).data.event,
      authoritative("tool_call_end", 3, { tool: "read_file", toolCallId: "call-1", result: { ok: true } }).data.event,
      authoritative("llm_delta", 4, { text: "B" }).data.event,
    ];
    for (const envelope of events) dispatchTurnEnvelope({ targetMessage: ordered, envelope, classifyRealtimeLog: classify });
    for (const envelope of [events[0], events[2], events[1], events[3], events[2]]) {
      dispatchTurnEnvelope({ targetMessage: reordered, envelope, classifyRealtimeLog: classify });
    }
    const observable = ({ content, toolTimeline, activityTimeline, messageEventState }) => ({
      content, toolTimeline, activityTimeline,
      messageEventState: {
        lastSequence: messageEventState.lastSequence,
        consumedEventIds: messageEventState.consumedEventIds,
      },
    });
    expect(observable(reordered)).toEqual(observable(ordered));
  });

  it("keeps stopped and continuation turns isolated across refresh replay", () => {
    const stopped = { sessionId: "session-1", messageId: "stopped", turnScopeId: "turn-stopped", content: "old" };
    const continuation = { sessionId: "session-1", messageId: "message-1", turnScopeId: "turn-1" };
    const toolCall = authoritative("tool_call_start", 1, {
      tool: "read_file", toolCallId: "call-continue", args: {}, dialogProcessId: "shared-dialog",
    }).data.event;
    const conflict = dispatchTurnEnvelope({ targetMessage: stopped, envelope: toolCall, classifyRealtimeLog: classify });
    dispatchTurnEnvelope({ targetMessage: continuation, envelope: toolCall, classifyRealtimeLog: classify });
    const staleSnapshot = hydrateTurnSnapshot({
      targetMessage: continuation,
      snapshot: { sessionId: "session-1", turnScopeId: "turn-1", throughSequence: 0 },
    });
    expect(conflict.result).toBe("message_identity_conflict");
    expect(stopped.toolTimeline).toBeUndefined();
    expect(selectToolTimelineLogs(continuation)).toHaveLength(1);
    expect(staleSnapshot.result).toBe("snapshot_stale");
  });

  it("does not mistake same-sequence legacy and authoritative events for the same fact", () => {
    const targetMessage = { messageId: "message-1", turnScopeId: "turn-1" };
    const authoritativeDelta = authoritative("llm_delta", 1, { text: "canonical" });
    const authoritativeTool = authoritative("tool_call_start", 2, {
      tool: "read_file", toolCallId: "call-1", args: {},
    });
    applyReconnectEnvelopeToTargetMessage({ envelope: authoritativeDelta, targetMessage, classifyRealtimeLog: classify });
    applyReconnectEnvelopeToTargetMessage({ envelope: authoritativeTool, targetMessage, classifyRealtimeLog: classify });
    applyReconnectEnvelopeToTargetMessage({
      envelope: { event: "delta", sequence: 1, data: { seq: 1, text: " duplicate" } },
      targetMessage,
      classifyRealtimeLog: classify,
    });
    applyReconnectEnvelopeToTargetMessage({
      envelope: { event: "thinking", sequence: 2, data: { seq: 2, text: "duplicate tool" } },
      targetMessage,
      classifyRealtimeLog: classify,
    });

    expect(targetMessage.content).toBe("canonical duplicate");
    expect([
      ...selectToolTimelineLogs(targetMessage),
      ...selectActivityTimelineLogs(targetMessage),
      ...(targetMessage.realtimeLogs || []),
    ]).toHaveLength(2);
  });
});
