/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { classifyExecutionEvent } from "../../src/observability/event-log/log-normalizer.js";
import {
  assertMessageEventEnvelope,
  bindAssistantMessageEventStream,
  beginAssistantMessageEventStream,
  emitMessageEvent,
  isMessageEventEnvelope,
} from "../../src/events/message-event-stream.js";

function runtimeForTurn({ messageId = "turn-message-1", presentationMessageId = "presentation-1" } = {}) {
  const runtime = {
    runConfig: { messageId, presentationMessageId },
    systemRuntime: { sessionId: "session-1" },
  };
  bindAssistantMessageEventStream(runtime, { messageId, presentationMessageId });
  return runtime;
}

test("authoritative message events declare the message-event sequence domain", () => {
  const emitted = [];
  const runtime = runtimeForTurn();
  beginAssistantMessageEventStream(runtime);
  const envelope = emitMessageEvent({ onEvent: (event) => emitted.push(event) }, runtime, "llm_delta", { text: "token" });

  assert.equal(envelope.sequenceDomain, "message-event");
  assert.equal(envelope.sequenceScopeId, envelope.messageId);
  assert.equal(emitted[0]?.data?.sequenceDomain, "message-event");
  assert.equal(emitted[0]?.data?.sequenceScopeId, envelope.messageId);
});

test("one Turn Aggregate owns a contiguous event sequence across model messages", () => {
  const runtime = runtimeForTurn();
  const listener = { onEvent() {} };
  const firstMessageId = beginAssistantMessageEventStream(runtime);
  const first = emitMessageEvent(listener, runtime, "llm_delta", { text: "first" });
  const second = emitMessageEvent(listener, runtime, "llm_delta", { text: "second" });
  const nextMessageId = beginAssistantMessageEventStream(runtime);
  const next = emitMessageEvent(listener, runtime, "llm_delta", { text: "next" });

  assert.notEqual(nextMessageId, firstMessageId);
  assert.deepEqual([first.sequence, second.sequence, next.sequence], [1, 2, 3]);
  assert.equal(first.sequenceScopeId, "turn-message-1");
  assert.equal(next.sequenceScopeId, "turn-message-1");
});

test("model streams keep independent identities while sharing the run presentation identity", () => {
  const runtime = runtimeForTurn({
    messageId: "turn-message-preallocated",
    presentationMessageId: "msg_preallocated",
  });
  const firstMessageId = beginAssistantMessageEventStream(runtime);
  const first = emitMessageEvent({ onEvent() {} }, runtime, "llm_delta", { text: "first" });
  const nextMessageId = beginAssistantMessageEventStream(runtime);
  const next = emitMessageEvent({ onEvent() {} }, runtime, "llm_delta", { text: "next" });

  assert.notEqual(nextMessageId, firstMessageId);
  assert.equal(first.messageId, "turn-message-preallocated");
  assert.equal(next.messageId, "turn-message-preallocated");
  assert.equal(first.presentationMessageId, "msg_preallocated");
  assert.equal(next.presentationMessageId, "msg_preallocated");
  assert.equal(first.envelopeVersion, 2);
  assert.deepEqual([first.sequence, next.sequence], [1, 2]);
});

test("Turn message event identity is immutable after binding", () => {
  const runtime = runtimeForTurn();
  assert.throws(() => bindAssistantMessageEventStream(runtime, {
    messageId: "other-message",
    presentationMessageId: "presentation-1",
  }), /messageId conflict/);
});

test("authoritative message envelope validation rejects partial events", () => {
  const envelope = {
    envelopeKind: "noobot.message_event",
    envelopeVersion: 2,
    eventId: "evt-1",
    eventType: "llm_delta",
    sessionId: "session-1",
    messageId: "message-1",
    presentationMessageId: "presentation-1",
    sequence: 1,
    timestamp: "2026-01-01T00:00:00.000Z",
    text: "token",
  };
  assert.equal(isMessageEventEnvelope(envelope), true);
  assert.equal(assertMessageEventEnvelope(envelope), envelope);
  assert.throws(() => assertMessageEventEnvelope({ ...envelope, text: undefined }), /missing_text/);
  assert.equal(isMessageEventEnvelope({ ...envelope, messageId: "" }), false);
  assert.throws(() => assertMessageEventEnvelope({ ...envelope, eventId: "" }), /invalid authoritative/);
});

test("classifyExecutionEvent classifies structured execution events", () => {
  assert.deepEqual(classifyExecutionEvent("semantic_transfer_validation"), {
    category: "semantic_transfer",
    type: "semantic_transfer",
  });
  assert.deepEqual(classifyExecutionEvent("tool_call_start"), {
    category: "tool",
    type: "tool_call",
  });
  assert.deepEqual(classifyExecutionEvent("tool_call_end"), {
    category: "tool",
    type: "tool_result",
  });
});
