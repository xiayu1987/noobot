/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  SECURITY_EVIDENCE_SOURCE,
  createSecurityAssessment,
  raiseSecurityAssessment,
} from "@noobot/security-assessment-protocol";
import { createEventEnvelope } from "@noobot/event-protocol";
import {
  MESSAGE_EVENT_TYPE,
  MESSAGE_CONTENT_EFFECT,
  MESSAGE_EVENT_WIRE_EVENT,
  hasMessageEventToolPayload,
  isAuthoritativeFinalContentEvent,
  projectMessageEventContent,
  projectMessageEventToolFacets,
  resolveMessageEventPresentationId,
  validateMessageEventPayload,
} from "@noobot/event-protocol/message-event";
import { EVENT_FAMILY, validateProtocolEvent } from "../src/event-registry.js";

function payload(overrides = {}) {
  return {
    eventType: MESSAGE_EVENT_TYPE.TOOL_CALL_START,
    presentationMessageId: "presentation-1",
    tool: "read_file",
    toolCallId: "call-1",
    ...overrides,
  };
}

function envelope(payloadOverrides = {}, envelopeOverrides = {}) {
  return createEventEnvelope({
    family: EVENT_FAMILY.MESSAGE_TIMELINE,
    identity: {
      eventId: "event-1",
      eventType: MESSAGE_EVENT_WIRE_EVENT,
      sessionId: "child-1",
      messageId: "message-1",
      ...(envelopeOverrides.identity || {}),
    },
    causality: {},
    ordering: {
      domain: "message-event",
      scopeId: "message-1",
      sequence: 1,
      ...(envelopeOverrides.ordering || {}),
    },
    producer: { type: "agent", id: "agent-1" },
    occurredAt: "2026-07-21T00:00:00.000Z",
    payload: payload(payloadOverrides),
  });
}

test("message family validates canonical v3 identity, ordering, and domain payload", () => {
  assert.deepEqual(validateProtocolEvent(envelope()).valid, true);
  assert.deepEqual(
    validateProtocolEvent(envelope({}, { ordering: { sequence: 0 } })).errors,
    ["sequence_below_family_minimum"],
  );
  assert.deepEqual(validateProtocolEvent(envelope({}, { identity: { messageId: "" } })).errors, [
    "missing_message_id",
  ]);
  assert.deepEqual(
    validateProtocolEvent(envelope({}, { ordering: { scopeId: "message-2" } })).errors,
    ["sequence_scope_mismatch"],
  );
});

test("message payload requires complete workflow ownership", () => {
  assert.deepEqual(validateMessageEventPayload(payload()), { valid: true, errors: [] });
  assert.deepEqual(validateMessageEventPayload(payload({ workflowRunId: "run-1" })).errors, [
    "incomplete_workflow_identity",
    "missing_workflow_parent_session",
  ]);
  assert.deepEqual(
    validateMessageEventPayload(
      payload({ workflowRunId: "run-1", nodeExecutionId: "node-1", parentSessionId: "root-1" }),
    ),
    { valid: true, errors: [] },
  );
});

test("message payload owns presentation identity and content semantics", () => {
  const current = payload();
  assert.equal(resolveMessageEventPresentationId(current), "presentation-1");
  assert.equal(isAuthoritativeFinalContentEvent(payload({ eventType: "main_model_content" })), false);
  assert.equal(
    isAuthoritativeFinalContentEvent(payload({ eventType: "authoritative_final_content" })),
    true,
  );
  assert.deepEqual(validateMessageEventPayload(payload({ presentationMessageId: "" })).errors, [
    "missing_presentation_message_id",
  ]);
  assert.deepEqual(
    projectMessageEventContent(payload({ eventType: "llm_delta", text: "token" })),
    { effect: MESSAGE_CONTENT_EFFECT.APPEND, content: "token" },
  );
  assert.deepEqual(projectMessageEventContent(payload()), {
    effect: MESSAGE_CONTENT_EFFECT.NONE,
    content: "",
  });
});

test("message payload validates and projects tool facts", () => {
  assert.deepEqual(validateMessageEventPayload(payload({ args: {} })), { valid: true, errors: [] });
  assert.deepEqual(
    validateMessageEventPayload(payload({ eventType: MESSAGE_EVENT_TYPE.LLM_DELTA, text: "token" })),
    { valid: true, errors: [] },
  );
  const started = projectMessageEventToolFacets(
    payload({ args: { filePath: "notes.txt" }, toolCallId: "call-1" }),
  );
  assert.deepEqual(started.toolCall, {
    id: "call-1",
    name: "read_file",
    args: { filePath: "notes.txt" },
  });
  const endedPayload = payload({
    eventType: MESSAGE_EVENT_TYPE.TOOL_CALL_END,
    result: "body",
    success: true,
  });
  assert.deepEqual(validateMessageEventPayload(endedPayload), { valid: true, errors: [] });
  assert.deepEqual(projectMessageEventToolFacets(endedPayload).toolResult, {
    toolCallId: "call-1",
    name: "read_file",
    output: "body",
    success: true,
  });
  assert.equal(hasMessageEventToolPayload(payload()), true);
});

test("message payload keeps top-level tool success as the only terminal authority", () => {
  const conflicting = payload({
    eventType: MESSAGE_EVENT_TYPE.TOOL_CALL_END,
    result: { ok: true },
    success: false,
    toolResult: { tool_call_id: "call-1", output: { ok: true }, success: true },
  });
  assert.deepEqual(validateMessageEventPayload(conflicting).errors, ["conflicting_tool_success"]);
  assert.equal(projectMessageEventToolFacets(conflicting).toolResult.success, false);
});

test("message payload validates and projects canonical tool risk", () => {
  const securityAssessment = createSecurityAssessment({
    toolName: "read_file",
    args: { riskLevel: "low" },
  });
  const raisedAssessment = raiseSecurityAssessment(securityAssessment, {
    source: SECURITY_EVIDENCE_SOURCE.NORMALIZED_RESOURCE,
    riskLevel: "high",
  });
  const started = payload({ riskLevel: "low", securityAssessment });
  const ended = payload({
    eventType: MESSAGE_EVENT_TYPE.TOOL_CALL_END,
    result: { ok: true },
    success: true,
    riskLevel: "high",
    securityAssessment: raisedAssessment,
  });
  assert.deepEqual(validateMessageEventPayload(started), { valid: true, errors: [] });
  assert.deepEqual(validateMessageEventPayload(ended), { valid: true, errors: [] });
  assert.equal(projectMessageEventToolFacets(started).toolCall.riskLevel, "low");
  assert.equal(projectMessageEventToolFacets(ended).toolResult.riskLevel, "high");
});
