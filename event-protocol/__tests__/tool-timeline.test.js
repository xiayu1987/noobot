/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  reduceCanonicalToolTimeline,
  resolveCanonicalToolTimelineStatus,
} from "../src/tool-timeline.js";
import { createEventEnvelope } from "../src/envelope.js";
import { EVENT_FAMILY } from "../src/event-registry.js";
import { MESSAGE_EVENT_WIRE_EVENT } from "../src/message-event.js";
import {
  SECURITY_EVIDENCE_SOURCE,
  createSecurityAssessment,
  raiseSecurityAssessment,
} from "@noobot/security-assessment-protocol";

const initialAssessment = createSecurityAssessment({
  toolName: "read_file",
  args: { riskLevel: "low" },
});
const raisedAssessment = raiseSecurityAssessment(initialAssessment, {
  source: SECURITY_EVIDENCE_SOURCE.NORMALIZED_RESOURCE,
  riskLevel: "high",
});

function event(eventType, sequence, extra = {}) {
  return createEventEnvelope({
    family: EVENT_FAMILY.MESSAGE_TIMELINE,
    identity: {
      eventId: `event-${sequence}`,
      eventType: MESSAGE_EVENT_WIRE_EVENT,
      sessionId: "session-1",
      messageId: "message-1",
    },
    causality: {},
    ordering: { domain: "message-event", scopeId: "message-1", sequence },
    producer: { type: "agent", id: "agent-1" },
    occurredAt: `2026-08-15T01:00:0${sequence}.000Z`,
    payload: {
      eventType,
      presentationMessageId: "presentation-1",
      toolCallId: "call-1",
      tool: "read_file",
      ...extra,
    },
  });
}

test("canonical tool timeline keeps failed terminal state across call and result order", () => {
  let timeline = reduceCanonicalToolTimeline(
    [],
    event("tool_call_start", 1, {
      args: { filePath: "missing.txt", riskLevel: "low" },
      riskLevel: "low",
      securityAssessment: initialAssessment,
    }),
  );
  timeline = reduceCanonicalToolTimeline(
    timeline,
    event("tool_call_end", 2, {
      result: '{"ok":false,"error":"missing"}',
      success: false,
      riskLevel: "high",
      securityAssessment: raisedAssessment,
    }),
  );

  assert.equal(timeline[0].key, "call:call-1");
  assert.equal(timeline[0].tool, "read_file");
  assert.deepEqual(timeline[0].args, { filePath: "missing.txt", riskLevel: "low" });
  assert.equal(timeline[0].call.eventId, "event-1");
  assert.equal(timeline[0].resultEvent.eventId, "event-2");
  assert.equal(timeline[0].riskLevel, "high");
  assert.equal(timeline[0].status, "failed");
  assert.equal(timeline[0].success, false);
  assert.equal(resolveCanonicalToolTimelineStatus(timeline[0]), "failed");

  timeline = reduceCanonicalToolTimeline(
    timeline,
    event("tool_call_start", 1, {
      args: { filePath: "missing.txt", riskLevel: "low" },
      riskLevel: "low",
      securityAssessment: initialAssessment,
    }),
  );
  assert.equal(timeline[0].status, "failed");
});

test("canonical tool timeline marks successful results completed", () => {
  const timeline = reduceCanonicalToolTimeline(
    [],
    event("tool_call_end", 1, { result: '{"ok":true}', success: true }),
  );
  assert.equal(timeline[0].status, "completed");
  assert.equal(timeline[0].success, true);
});
