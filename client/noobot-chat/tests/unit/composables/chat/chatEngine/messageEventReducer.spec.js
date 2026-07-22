import { describe, expect, it } from "vitest";
import { classifyRealtimeLog } from "../../../../../src/app/state/sessionMessageState";
import {
  MESSAGE_EVENT_REDUCE_RESULT,
  reduceMessageEvent,
} from "../../../../../src/composables/chat/chatEngine/messageEventReducer";
import { selectToolTimeline, selectToolTimelineLogs } from "../../../../../src/composables/chat/chatEngine/toolTimeline";

function event(overrides = {}) {
  return {
    envelopeKind: "noobot.message_event", envelopeVersion: 1,
    eventId: "evt-1", eventType: "tool_call_start",
    sessionId: "session-1", messageId: "message-1", sequence: 1,
    timestamp: "2026-01-01T00:00:00.000Z", turnScopeId: "turn-1",
    tool: "read_file", toolCallId: "call-1", args: {}, ...overrides,
  };
}

function message(overrides = {}) {
  return { id: "message-1", messageId: "message-1", turnScopeId: "turn-1", content: "", realtimeLogs: [], ...overrides };
}

const reduce = (targetMessage, envelope) => reduceMessageEvent({ targetMessage, event: envelope, classifyRealtimeLog });

describe("reduceMessageEvent", () => {
  it("applies text and no-text tool lifecycle events", () => {
    const target = message();
    expect(reduce(target, event()).result).toBe(MESSAGE_EVENT_REDUCE_RESULT.APPLIED);
    expect(selectToolTimelineLogs(target)[0]).toMatchObject({ type: "tool_call", toolCallId: "call-1" });
    expect(reduce(target, event({ eventId: "evt-2", eventType: "tool_call_end", sequence: 2, result: { ok: true } })).result)
      .toBe(MESSAGE_EVENT_REDUCE_RESULT.APPLIED);
    expect(selectToolTimelineLogs(target)[1].type).toBe("tool_result");
    expect(selectToolTimeline(target)).toHaveLength(1);
    expect(reduce(target, event({ eventId: "evt-3", eventType: "llm_delta", sequence: 3, text: "hello" })).result)
      .toBe(MESSAGE_EVENT_REDUCE_RESULT.APPLIED);
    expect(target.content).toBe("hello");
  });

  it("returns observable idempotency and sequence outcomes", () => {
    const target = message();
    reduce(target, event());
    expect(reduce(target, event()).result).toBe(MESSAGE_EVENT_REDUCE_RESULT.DUPLICATE);
    expect(reduce(target, event({ eventId: "evt-stale", sequence: 1 })).result).toBe(MESSAGE_EVENT_REDUCE_RESULT.STALE);
    expect(reduce(target, event({ eventId: "evt-gap", sequence: 3 })).result).toBe(MESSAGE_EVENT_REDUCE_RESULT.SEQUENCE_GAP);
  });

  it("rejects invalid, missing targets and identity conflicts", () => {
    expect(reduce(null, event()).result).toBe(MESSAGE_EVENT_REDUCE_RESULT.TARGET_MISSING);
    expect(reduce(message(), event({ toolCallId: "" })).result).toBe(MESSAGE_EVENT_REDUCE_RESULT.INVALID);
    expect(reduce(message({ id: "other", messageId: "other" }), event()).result)
      .toBe(MESSAGE_EVENT_REDUCE_RESULT.MESSAGE_IDENTITY_CONFLICT);
  });
});
