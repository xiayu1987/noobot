/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  assertMessageEventEnvelope,
  MESSAGE_EVENT_TYPE,
  MESSAGE_CONTENT_EFFECT,
  validateMessageEventEnvelope,
  hasMessageEventToolPayload,
  projectMessageEventContent,
  projectMessageEventToolFacets,
} from "../message-event-protocol.mjs";

function envelope(overrides = {}) {
  return {
    envelopeKind: "noobot.message_event",
    envelopeVersion: 1,
    eventId: "event-1",
    eventType: "tool_call_start",
    sessionId: "child-1",
    messageId: "message-1",
    sequence: 1,
    timestamp: "2026-07-21T00:00:00.000Z",
    tool: "read_file",
    toolCallId: "call-1",
    ...overrides,
  };
}

test("message event protocol validates the authoritative identity envelope", () => {
  assert.equal(assertMessageEventEnvelope(envelope()).sessionId, "child-1");
  assert.throws(() => assertMessageEventEnvelope(envelope({ messageId: "" })), /invalid authoritative/);
});

test("message event protocol validates semantic payloads without requiring display text for tools", () => {
  assert.deepEqual(validateMessageEventEnvelope(envelope({ args: {} })), { valid: true, errors: [] });
  assert.deepEqual(
    validateMessageEventEnvelope(envelope({ eventType: MESSAGE_EVENT_TYPE.LLM_DELTA, text: "token" })),
    { valid: true, errors: [] },
  );
  assert.deepEqual(
    validateMessageEventEnvelope(envelope({ eventType: MESSAGE_EVENT_TYPE.TOOL_CALL_END, result: { ok: true } })),
    { valid: true, errors: [] },
  );
  assert.deepEqual(
    validateMessageEventEnvelope(envelope({ toolCallId: "", args: {} })).errors,
    ["missing_tool_call_id"],
  );
});

test("message event protocol projects backend tool fields to canonical facets", () => {
  const started = projectMessageEventToolFacets(envelope({
    tool: "read_file",
    args: { filePath: "notes.txt" },
    toolCallId: "call-1",
  }));
  assert.deepEqual(started.toolCall, {
    id: "call-1",
    name: "read_file",
    args: { filePath: "notes.txt" },
  });
  const ended = projectMessageEventToolFacets(envelope({
    eventType: "tool_call_end",
    tool: "read_file",
    result: "body",
    success: true,
    toolCallId: "call-1",
  }));
  assert.deepEqual(ended.toolResult, {
    toolCallId: "call-1",
    name: "read_file",
    output: "body",
    success: true,
  });
  assert.equal(hasMessageEventToolPayload(envelope({ tool: "read_file" })), true);
});

test("message content protocol separates incremental delivery from authoritative final content", () => {
  assert.deepEqual(
    projectMessageEventContent(envelope({ eventType: "llm_delta", text: "token" })),
    { effect: MESSAGE_CONTENT_EFFECT.APPEND, content: "token" },
  );
  assert.deepEqual(
    projectMessageEventContent(envelope({ eventType: "main_model_content", text: "final" })),
    { effect: MESSAGE_CONTENT_EFFECT.REPLACE, content: "final" },
  );
  assert.deepEqual(
    projectMessageEventContent(envelope()),
    { effect: MESSAGE_CONTENT_EFFECT.NONE, content: "" },
  );
});
