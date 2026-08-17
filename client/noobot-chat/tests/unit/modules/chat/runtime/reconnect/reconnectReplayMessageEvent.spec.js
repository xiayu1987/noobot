/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  applyReconnectEnvelopeBatchToTargetMessage,
  applyReconnectEnvelopeToTargetMessage,
} from "../../../../../../src/modules/chat/runtime/reconnect/batchReplay.js";
import {
  dispatchTurnEnvelope,
  hydrateTurnSnapshot,
  TURN_PROJECTION_SOURCE,
} from "../../../../../../src/modules/chat/runtime/engine/turnProjectionStore.js";
import { selectToolTimelineLogs } from "../../../../../../src/modules/chat/runtime/engine/toolTimeline.js";
import { selectActivityTimelineLogs } from "../../../../../../src/modules/chat/runtime/engine/activityTimeline.js";
import { canonicalMessageEvent } from "../../helpers/messageEventFixture.js";

const classify = (event) => ({
  ...event,
  type: event.eventType === "tool_call_start"
    ? "tool_call"
    : event.eventType === "tool_call_end"
      ? "tool_result"
      : event.type || event.eventType,
  text: event.eventType === "tool_call_start"
    ? `[tool] ${event.tool}`
    : event.eventType === "tool_call_end"
      ? "[tool] result"
      : event.text || event.output || "",
});

const authoritative = (eventType, sequence, extra = {}) => canonicalMessageEvent({
  eventId: `event-${sequence}`,
  eventType,
  sessionId: "session-1",
  messageId: "message-1",
  presentationMessageId: "message-1",
  dialogProcessId: "dialog-1",
  turnScopeId: "turn-1",
  sequence,
  occurredAt: `2026-07-22T05:00:0${sequence}.000Z`,
  ...extra,
});

const canonicalFindFor = (targetMessage) => (sessionId, messageId) => {
  if (sessionId !== targetMessage.sessionId) return null;
  if (messageId !== targetMessage.messageId) return null;
  return targetMessage;
};

describe("reconnect authoritative message event replay", () => {
  it("restores multiple assistant messages in one turn by each authoritative messageId", () => {
    const canonicalMessages = new Map([
      ["message-1", { id: "message-1", messageId: "message-1", sessionId: "session-1", turnScopeId: "turn-1", content: "" }],
      ["message-2", { id: "message-2", messageId: "message-2", sessionId: "session-1", turnScopeId: "turn-1", content: "" }],
    ]);
    const findCanonicalMessageById = (sessionId, messageId) => sessionId === "session-1"
      ? canonicalMessages.get(messageId) || null
      : null;
    const first = authoritative("llm_delta", 1, { messageId: "message-1", text: "first" });
    const second = authoritative("llm_delta", 1, {
      messageId: "message-2",
      presentationMessageId: "message-2",
      eventId: "message-2-event-1",
      text: "second",
    });

    applyReconnectEnvelopeBatchToTargetMessage({
      messages: [first, second],
      targetMessage: null,
      findCanonicalMessageById,
      classifyRealtimeLog: classify,
    });

    expect([...canonicalMessages.keys()]).toEqual(["message-1", "message-2"]);
    expect(canonicalMessages.get("message-1")).toMatchObject({ content: "first", turnScopeId: "turn-1" });
    expect(canonicalMessages.get("message-2")).toMatchObject({ content: "second", turnScopeId: "turn-1" });
    expect(canonicalMessages.get("message-1").messageEventState.lastSequence).toBe(1);
    expect(canonicalMessages.get("message-2").messageEventState.lastSequence).toBe(1);
  });

  it("rejects reconnect message events without an authoritative messageId", () => {
    const findCanonicalMessageById = () => {
      throw new Error("must not upsert an unidentified message");
    };
    const envelope = authoritative("llm_delta", 1, { messageId: "", text: "wrong" });

    const applied = applyReconnectEnvelopeToTargetMessage({
      envelope,
      targetMessage: { messageId: "legacy", content: "unchanged" },
      findCanonicalMessageById,
      classifyRealtimeLog: classify,
    });

    expect(applied).toBe(false);
    expect(envelope.identity.messageId).toBe("");
  });

  it("uses the canonical reducer and consumes no-text tool events idempotently", () => {
    const targetMessage = {
      messageId: "message-1",
      sessionId: "session-1",
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
      success: true,
    });

    const findCanonicalMessageById = canonicalFindFor(targetMessage);
    applyReconnectEnvelopeToTargetMessage({ envelope: start, findCanonicalMessageById, classifyRealtimeLog: classify });
    applyReconnectEnvelopeToTargetMessage({ envelope: start, findCanonicalMessageById, classifyRealtimeLog: classify });
    applyReconnectEnvelopeToTargetMessage({ envelope: end, findCanonicalMessageById, classifyRealtimeLog: classify });

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

  it("continues guidance analysis on the refreshed canonical message", () => {
    const targetMessage = {
      messageId: "message-1",
      sessionId: "session-1",
      turnScopeId: "turn-1",
      content: "",
    };
    const guidance = (sequence, output) => authoritative("thinking", sequence, {
      eventId: `guidance-analysis-${sequence}`,
      messageId: "model-message-1",
      presentationMessageId: "message-1",
      sequenceDomain: "message-event",
      sequenceScopeId: "model-message-1",
      event: "guidance_analysis_response",
      type: "guidance_analysis",
      purpose: "guidance",
      pluginFlow: "analysis",
      chain: "auxiliary",
      text: output,
      output,
    });
    const findCanonicalMessageById = canonicalFindFor(targetMessage);

    applyReconnectEnvelopeToTargetMessage({
      envelope: guidance(1, "analysis before refresh"),
      findCanonicalMessageById,
      classifyRealtimeLog: classify,
    });
    applyReconnectEnvelopeToTargetMessage({
      envelope: guidance(2, "analysis after refresh"),
      findCanonicalMessageById,
      classifyRealtimeLog: classify,
    });

    expect(selectActivityTimelineLogs(targetMessage)).toEqual([
      expect.objectContaining({
        eventId: "guidance-analysis-1",
        output: "analysis before refresh",
        sequenceDomain: "message-event",
      }),
      expect.objectContaining({
        eventId: "guidance-analysis-2",
        output: "analysis after refresh",
        sequenceDomain: "message-event",
      }),
    ]);
    expect(targetMessage.messageEventState.consumedEventIds).toEqual([
      "guidance-analysis-1",
      "guidance-analysis-2",
    ]);
  });

  it("produces equivalent state for normal live, reconnect live and history replay", () => {
    const events = [
      authoritative("llm_delta", 1, { text: "hello " }),
      authoritative("tool_call_start", 2, {
        tool: "read_file", toolCallId: "call-1", args: { filePath: "notes.txt" },
      }),
      authoritative("tool_call_end", 3, {
        tool: "read_file", toolCallId: "call-1", result: { ok: true }, success: true,
      }),
      authoritative("llm_delta", 4, { text: "world" }),
    ];
    const createTarget = () => ({ sessionId: "session-1", messageId: "message-1", turnScopeId: "turn-1" });
    const normalLive = createTarget();
    const reconnectLive = createTarget();
    const historyReplay = createTarget();

    for (const envelope of events) {
      dispatchTurnEnvelope({
        targetMessage: normalLive,
        envelope,
        classifyRealtimeLog: classify,
        source: TURN_PROJECTION_SOURCE.NORMAL_LIVE,
      });
      dispatchTurnEnvelope({
        targetMessage: reconnectLive,
        envelope,
        classifyRealtimeLog: classify,
        source: TURN_PROJECTION_SOURCE.RECONNECT_LIVE,
      });
      applyReconnectEnvelopeToTargetMessage({
        envelope,
        findCanonicalMessageById: canonicalFindFor(historyReplay),
        classifyRealtimeLog: classify,
      });
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
      envelope: authoritative("llm_delta", 1, { turnScopeId: "turn-continuation", text: "wrong" }),
      classifyRealtimeLog: classify,
      source: TURN_PROJECTION_SOURCE.HISTORY_REPLAY,
    });

    expect(result.result).toBe("message_identity_conflict");
    expect(targetMessage.content).toBeUndefined();
  });

  it("does not allow an older snapshot boundary to replace newer live projection", () => {
    const targetMessage = { sessionId: "session-1", messageId: "message-1", turnScopeId: "turn-1" };
    for (const sequence of [1, 2]) {
      dispatchTurnEnvelope({
        targetMessage,
        envelope: authoritative("llm_delta", sequence, { text: String(sequence) }),
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
      authoritative("llm_delta", 1, { text: "A" }),
      authoritative("tool_call_start", 2, { tool: "read_file", toolCallId: "call-1", args: {} }),
      authoritative("tool_call_end", 3, {
        tool: "read_file", toolCallId: "call-1", result: { ok: true }, success: true,
      }),
      authoritative("llm_delta", 4, { text: "B" }),
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
    });
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

  it("ignores non-canonical transport events after canonical facts", () => {
    const targetMessage = {
      sessionId: "session-1",
      messageId: "message-1",
      turnScopeId: "turn-1",
    };
    const authoritativeDelta = authoritative("llm_delta", 1, { text: "canonical" });
    const authoritativeTool = authoritative("tool_call_start", 2, {
      tool: "read_file", toolCallId: "call-1", args: {},
    });
    const findCanonicalMessageById = canonicalFindFor(targetMessage);
    applyReconnectEnvelopeToTargetMessage({ envelope: authoritativeDelta, findCanonicalMessageById, classifyRealtimeLog: classify });
    applyReconnectEnvelopeToTargetMessage({ envelope: authoritativeTool, findCanonicalMessageById, classifyRealtimeLog: classify });
    applyReconnectEnvelopeToTargetMessage({
      envelope: { event: "delta", sequence: 1, data: { seq: 1, text: " duplicate" } },
      findCanonicalMessageById,
      classifyRealtimeLog: classify,
    });
    applyReconnectEnvelopeToTargetMessage({
      envelope: { event: "thinking", sequence: 2, data: { seq: 2, text: "duplicate tool" } },
      findCanonicalMessageById,
      classifyRealtimeLog: classify,
    });

    expect(targetMessage.content).toBe("canonical");
    expect([
      ...selectToolTimelineLogs(targetMessage),
      ...selectActivityTimelineLogs(targetMessage),
    ]).toHaveLength(1);
  });
});
