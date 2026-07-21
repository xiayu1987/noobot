/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  assertMessageEventEnvelope,
  hasMessageEventToolPayload,
  projectMessageEventToolFacets,
  projectMessageEventToolLifecycle,
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
    ...overrides,
  };
}

test("message event protocol validates the authoritative identity envelope", () => {
  assert.equal(assertMessageEventEnvelope(envelope()).sessionId, "child-1");
  assert.throws(() => assertMessageEventEnvelope(envelope({ messageId: "" })), /invalid authoritative/);
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

test("message event protocol projects one tool execution lifecycle", () => {
  assert.deepEqual(projectMessageEventToolLifecycle(envelope()), {
    event: "tool_call",
    status: "running",
    terminal: false,
  });
  assert.deepEqual(projectMessageEventToolLifecycle(envelope({
    eventType: "tool_call_end",
    success: false,
  })), {
    event: "tool_result",
    status: "failed",
    terminal: true,
  });
  assert.equal(projectMessageEventToolLifecycle({ eventType: "llm_delta" }), undefined);
});
