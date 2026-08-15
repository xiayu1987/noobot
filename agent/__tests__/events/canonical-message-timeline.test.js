/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { reduceCanonicalToolTimeline } from "../../src/events/canonical-message-timeline.js";

const event = (eventType, eventId, sequence, extra = {}) => ({
  envelopeKind: "noobot.message_event",
  envelopeVersion: 2,
  eventType,
  eventId,
  sequence,
  messageId: "model-message-1",
  presentationMessageId: "presentation-1",
  sequenceScopeId: "model-message-1",
  sequenceDomain: "message-event",
  authority: "authoritative",
  timestamp: `2026-07-29T01:00:0${sequence}.000Z`,
  toolCallId: "call-1",
  tool: "read_file",
  ...extra,
});

test("canonical tool reducer merges call and result by stable toolCallId", () => {
  let timeline = reduceCanonicalToolTimeline(
    [],
    event("tool_call_start", "event-1", 1, { args: { path: "README.md" } }),
  );
  timeline = reduceCanonicalToolTimeline(
    timeline,
    event("tool_call_end", "event-2", 2, { result: { ok: true }, success: true }),
  );
  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].key, "call:call-1");
  assert.equal(timeline[0].status, "completed");
  assert.equal(timeline[0].call.eventId, "event-1");
  assert.equal(timeline[0].resultEvent.eventId, "event-2");
  assert.equal(timeline[0].call.sequenceDomain, "message-event");
  assert.equal(timeline[0].resultEvent.sequenceScopeId, "model-message-1");
  assert.equal("log" in timeline[0].call, false);
  assert.equal("log" in timeline[0].resultEvent, false);
});

test("canonical tool reducer is idempotent for a repeated envelope", () => {
  const start = event("tool_call_start", "event-1", 1, { args: {} });
  const once = reduceCanonicalToolTimeline([], start);
  const twice = reduceCanonicalToolTimeline(once, start);
  assert.deepEqual(twice, once);
});

test("canonical tool reducer persists failed results as failed", () => {
  let timeline = reduceCanonicalToolTimeline(
    [],
    event("tool_call_start", "event-1", 1, { args: { path: "missing.txt" } }),
  );
  timeline = reduceCanonicalToolTimeline(
    timeline,
    event("tool_call_end", "event-2", 2, {
      result: { ok: false },
      success: false,
    }),
  );

  assert.equal(timeline[0].success, false);
  assert.equal(timeline[0].status, "failed");
});
