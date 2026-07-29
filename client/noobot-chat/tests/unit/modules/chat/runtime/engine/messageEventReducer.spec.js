/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { classifyRealtimeLog } from "../../../../../../src/app/state/sessionMessageState.js";
import {
  MESSAGE_EVENT_REDUCE_RESULT,
  reduceMessageEvent,
} from "../../../../../../src/modules/chat/runtime/engine/messageEventReducer.js";
import { selectToolTimeline, selectToolTimelineLogs } from "../../../../../../src/modules/chat/runtime/engine/toolTimeline.js";
import { selectActivityTimelineLogs } from "../../../../../../src/modules/chat/runtime/engine/activityTimeline.js";

function event(overrides = {}) {
  return {
    envelopeKind: "noobot.message_event", envelopeVersion: 2,
    eventId: "evt-1", eventType: "tool_call_start",
    sessionId: "session-1", messageId: "message-1", presentationMessageId: "message-1", sequence: 1,
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

  it("converges streamed deltas and non-streamed final content to the same projection", () => {
    const streamed = message();
    reduce(streamed, event({ eventId: "evt-1", eventType: "llm_delta", sequence: 1, text: "draft " }));
    reduce(streamed, event({ eventId: "evt-2", eventType: "llm_delta", sequence: 2, text: "tokens" }));
    reduce(streamed, event({
      eventId: "evt-3", eventType: "authoritative_final_content", sequence: 3,
      text: "authoritative final", output: "authoritative final",
    }));

    const nonStreamed = message();
    reduce(nonStreamed, event({
      eventId: "evt-final", eventType: "authoritative_final_content", sequence: 1,
      text: "authoritative final", output: "authoritative final",
    }));

    expect(streamed.content).toBe("authoritative final");
    expect(nonStreamed.content).toBe(streamed.content);
    expect(streamed.messageEventState.finalContentSequence).toBe(3);
    expect(nonStreamed.messageEventState.finalContentSequence).toBe(1);
  });

  it("keeps authoritative final content immutable against later deltas", () => {
    const target = message();
    expect(reduce(target, event({
      eventId: "evt-final", eventType: "authoritative_final_content", sequence: 1,
      text: "authoritative final", output: "authoritative final",
    })).result).toBe(MESSAGE_EVENT_REDUCE_RESULT.APPLIED);

    expect(reduce(target, event({
      eventId: "evt-late-delta", eventType: "llm_delta", sequence: 2, text: " late",
    })).result).toBe(MESSAGE_EVENT_REDUCE_RESULT.FINAL_CONTENT_LOCKED);
    expect(target.content).toBe("authoritative final");
    expect(target.messageEventState.finalContentSequence).toBe(1);
    expect(target.messageEventState.lastSequence).toBe(1);
  });

  it("rejects invalid, missing targets and identity conflicts", () => {
    expect(reduce(null, event()).result).toBe(MESSAGE_EVENT_REDUCE_RESULT.TARGET_MISSING);
    expect(reduce(message(), event({ toolCallId: "" })).result).toBe(MESSAGE_EVENT_REDUCE_RESULT.INVALID);
    expect(reduce(message({ id: "other", messageId: "other" }), event()).result)
      .toBe(MESSAGE_EVENT_REDUCE_RESULT.MESSAGE_IDENTITY_CONFLICT);
  });

  it("validates the explicit presentation identity independently from the source message", () => {
    const target = message({ id: "presentation-1", messageId: "presentation-1" });
    const projected = event({
      envelopeVersion: 2,
      messageId: "model-message-1",
      presentationMessageId: "presentation-1",
    });
    expect(reduce(target, projected).result).toBe(MESSAGE_EVENT_REDUCE_RESULT.APPLIED);
    expect(reduce(message(), {
      ...projected,
      eventId: "evt-conflict",
    }).result).toBe(MESSAGE_EVENT_REDUCE_RESULT.MESSAGE_IDENTITY_CONFLICT);
  });

  it("keeps guidance and v2 model analysis on the same presentation activity timeline", () => {
    const target = message({ id: "presentation-1", messageId: "presentation-1" });
    expect(reduce(target, event({
      eventId: "evt-guidance-analysis",
      eventType: "thinking",
      event: "guidance_analysis_response",
      type: "guidance_analysis",
      purpose: "guidance",
      pluginFlow: "analysis",
      chain: "auxiliary",
      messageId: "model-message-1",
      presentationMessageId: "presentation-1",
      sequenceScopeId: "model-message-1",
      tool: "",
      toolCallId: "",
      args: undefined,
      text: "guidance analysis",
      output: "guidance analysis",
    })).result).toBe(MESSAGE_EVENT_REDUCE_RESULT.APPLIED);
    const projected = event({
      envelopeVersion: 2,
      eventId: "evt-model-analysis",
      sequence: 2,
      eventType: "main_model_content",
      messageId: "model-message-1",
      presentationMessageId: "presentation-1",
      tool: "",
      toolCallId: "",
      args: undefined,
      text: "intermediate model analysis",
      output: "intermediate model analysis",
    });

    expect(reduce(target, projected).result).toBe(MESSAGE_EVENT_REDUCE_RESULT.APPLIED);
    expect(target.content).toBe("");
    expect(target.activityTimeline).toHaveLength(2);
    expect(selectActivityTimelineLogs(target)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: "guidance_analysis_response",
        text: "guidance analysis",
      }),
      expect.objectContaining({
        event: "main_model_content",
        text: "intermediate model analysis",
        messageId: "model-message-1",
        presentationMessageId: "presentation-1",
      }),
    ]));
  });
});
