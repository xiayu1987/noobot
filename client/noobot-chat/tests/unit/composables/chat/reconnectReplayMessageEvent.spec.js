/*
 * Copyright (c) 2026 xiayu
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { applyReconnectEnvelopeToTargetMessage } from "../../../../src/composables/chat/reconnectReplay/batchReplay";
import { reduceMessageEvent } from "../../../../src/composables/chat/chatEngine/messageEventReducer";

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
      realtimeLogs: [],
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

    expect(targetMessage.realtimeLogs).toEqual([
      expect.objectContaining({ type: "tool_call", toolCallId: "call-1" }),
      expect.objectContaining({ type: "tool_result", toolCallId: "call-1" }),
    ]);
    expect(targetMessage.executionLogTotal).toBe(2);
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
      // Both live transports use this canonical consumer after independently
      // resolving their target message; replay additionally unwraps transport.
      reduceMessageEvent({ targetMessage: normalLive, event: envelope.data.event, classifyRealtimeLog: classify });
      reduceMessageEvent({ targetMessage: reconnectLive, event: envelope.data.event, classifyRealtimeLog: classify });
      applyReconnectEnvelopeToTargetMessage({ envelope, targetMessage: historyReplay, classifyRealtimeLog: classify });
    }

    const observableState = ({ content, realtimeLogs, executionLogTotal, messageEventState }) => ({
      content, realtimeLogs, executionLogTotal, messageEventState,
    });
    expect(observableState(reconnectLive)).toEqual(observableState(normalLive));
    expect(observableState(historyReplay)).toEqual(observableState(normalLive));
    expect(normalLive).toMatchObject({ content: "hello world", executionLogTotal: 2 });
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

    // Cross-protocol sequence numbers express order, not fact identity. Until
    // producers provide a shared eventId/sourceEventId, neither fact may be
    // silently discarded merely because their sequence happens to match.
    expect(targetMessage.content).toBe("canonical duplicate");
    expect(targetMessage.realtimeLogs).toHaveLength(2);
    expect(targetMessage.executionLogTotal).toBe(2);
  });
});
