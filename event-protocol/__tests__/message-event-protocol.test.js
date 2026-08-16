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

import {
  assertMessageEventEnvelope,
  MESSAGE_EVENT_TYPE,
  MESSAGE_CONTENT_EFFECT,
  validateMessageEventEnvelope,
  hasMessageEventToolPayload,
  isAuthoritativeFinalContentEvent,
  projectMessageEventContent,
  projectMessageEventToolFacets,
  resolveMessageEventPresentationId,
  resolveMessageEventSequenceIdentity,
} from "@noobot/event-protocol/message-event";

function envelope(overrides = {}) {
  return {
    envelopeKind: "noobot.message_event",
    envelopeVersion: 2,
    eventId: "event-1",
    eventType: "tool_call_start",
    sessionId: "child-1",
    messageId: "message-1",
    presentationMessageId: "presentation-1",
    sequence: 1,
    timestamp: "2026-07-21T00:00:00.000Z",
    tool: "read_file",
    toolCallId: "call-1",
    ...overrides,
  };
}

test("message event protocol validates the authoritative identity envelope", () => {
  assert.equal(assertMessageEventEnvelope(envelope()).sessionId, "child-1");
  assert.throws(
    () => assertMessageEventEnvelope(envelope({ messageId: "" })),
    /invalid authoritative/,
  );
});

test("message event protocol keeps ordinary identity valid and requires complete workflow ownership", () => {
  assert.deepEqual(validateMessageEventEnvelope(envelope()), { valid: true, errors: [] });
  assert.deepEqual(validateMessageEventEnvelope(envelope({ workflowRunId: "run-1" })).errors, [
    "incomplete_workflow_identity",
    "missing_workflow_parent_session",
  ]);
  assert.deepEqual(
    validateMessageEventEnvelope(
      envelope({
        workflowRunId: "run-1",
        nodeExecutionId: "node-1",
        parentSessionId: "root-1",
      }),
    ),
    { valid: true, errors: [] },
  );
});

test("message event protocol requires an explicit presentation identity", () => {
  const current = envelope();
  assert.equal(assertMessageEventEnvelope(current), current);
  assert.equal(resolveMessageEventPresentationId(current), "presentation-1");
  assert.equal(
    isAuthoritativeFinalContentEvent(envelope({ eventType: "main_model_content" })),
    false,
  );
  assert.equal(
    isAuthoritativeFinalContentEvent({
      ...current,
      eventType: "main_model_content",
    }),
    false,
  );
  assert.equal(
    isAuthoritativeFinalContentEvent({
      ...current,
      eventType: "authoritative_final_content",
    }),
    true,
  );
  assert.throws(
    () => assertMessageEventEnvelope(envelope({ presentationMessageId: "" })),
    /invalid authoritative/,
  );
});

test("message event protocol makes the message-scoped sequence identity explicit", () => {
  assert.deepEqual(resolveMessageEventSequenceIdentity(envelope()), {
    sequenceDomain: "message-event",
    sequenceScopeKind: "message",
    sequenceScopeId: "message-1",
    sequence: 1,
    sequenceKey: "message-event:message-1",
  });
  assert.deepEqual(
    validateMessageEventEnvelope(
      envelope({
        sequenceDomain: "message-event",
        sequenceScopeId: "different-message",
      }),
    ).errors,
    ["sequence_scope_mismatch"],
  );
  assert.deepEqual(validateMessageEventEnvelope(envelope({ sequenceDomain: "turn" })).errors, [
    "sequence_domain_mismatch",
  ]);
});

test("message event protocol validates semantic payloads without requiring display text for tools", () => {
  assert.deepEqual(validateMessageEventEnvelope(envelope({ args: {} })), {
    valid: true,
    errors: [],
  });
  assert.deepEqual(
    validateMessageEventEnvelope(
      envelope({ eventType: MESSAGE_EVENT_TYPE.LLM_DELTA, text: "token" }),
    ),
    { valid: true, errors: [] },
  );
  assert.deepEqual(
    validateMessageEventEnvelope(
      envelope({
        eventType: MESSAGE_EVENT_TYPE.TOOL_CALL_END,
        result: { ok: true },
        success: true,
      }),
    ),
    { valid: true, errors: [] },
  );
  assert.deepEqual(validateMessageEventEnvelope(envelope({ toolCallId: "", args: {} })).errors, [
    "missing_tool_call_id",
  ]);
});

test("message event protocol projects backend tool fields to canonical facets", () => {
  const started = projectMessageEventToolFacets(
    envelope({
      tool: "read_file",
      args: { filePath: "notes.txt" },
      toolCallId: "call-1",
    }),
  );
  assert.deepEqual(started.toolCall, {
    id: "call-1",
    name: "read_file",
    args: { filePath: "notes.txt" },
  });
  const ended = projectMessageEventToolFacets(
    envelope({
      eventType: "tool_call_end",
      tool: "read_file",
      result: "body",
      success: true,
      toolCallId: "call-1",
    }),
  );
  assert.deepEqual(ended.toolResult, {
    toolCallId: "call-1",
    name: "read_file",
    output: "body",
    success: true,
  });
  assert.equal(hasMessageEventToolPayload(envelope({ tool: "read_file" })), true);
});

test("message event protocol keeps top-level tool success as the only terminal authority", () => {
  const conflicting = envelope({
    eventType: MESSAGE_EVENT_TYPE.TOOL_CALL_END,
    result: { ok: true },
    success: false,
    toolResult: { tool_call_id: "call-1", output: { ok: true }, success: true },
  });

  assert.deepEqual(validateMessageEventEnvelope(conflicting).errors, ["conflicting_tool_success"]);
  assert.equal(projectMessageEventToolFacets(conflicting).toolResult.success, false);
});

test("message event protocol validates and projects canonical tool risk levels", () => {
  const securityAssessment = createSecurityAssessment({
    toolName: "read_file",
    args: { riskLevel: "low" },
  });
  const raisedAssessment = raiseSecurityAssessment(securityAssessment, {
    source: SECURITY_EVIDENCE_SOURCE.NORMALIZED_RESOURCE,
    riskLevel: "high",
  });
  const started = envelope({ riskLevel: "low", securityAssessment });
  const ended = envelope({
    eventType: MESSAGE_EVENT_TYPE.TOOL_CALL_END,
    result: { ok: true },
    success: true,
    riskLevel: "high",
    securityAssessment: raisedAssessment,
  });

  assert.deepEqual(validateMessageEventEnvelope(started), { valid: true, errors: [] });
  assert.deepEqual(validateMessageEventEnvelope(ended), { valid: true, errors: [] });
  assert.equal(projectMessageEventToolFacets(started).toolCall.riskLevel, "low");
  assert.equal(projectMessageEventToolFacets(ended).toolResult.riskLevel, "high");
  assert.deepEqual(
    validateMessageEventEnvelope(envelope({ riskLevel: "high", securityAssessment })).errors,
    ["security_assessment_risk_mismatch"],
  );
  assert.deepEqual(validateMessageEventEnvelope(envelope({ riskLevel: "unknown" })).errors, [
    "missing_security_assessment",
    "invalid_tool_risk_level",
  ]);
  assert.deepEqual(
    validateMessageEventEnvelope(
      envelope({ eventType: MESSAGE_EVENT_TYPE.TOOL_CALL_END, result: { ok: true } }),
    ).errors,
    ["missing_tool_success"],
  );
});

test("message content protocol separates incremental delivery from authoritative final content", () => {
  assert.deepEqual(
    projectMessageEventContent(envelope({ eventType: "llm_delta", text: "token" })),
    { effect: MESSAGE_CONTENT_EFFECT.APPEND, content: "token" },
  );
  assert.deepEqual(
    projectMessageEventContent(
      envelope({
        eventType: "main_model_content",
        text: "intermediate model analysis",
      }),
    ),
    { effect: MESSAGE_CONTENT_EFFECT.NONE, content: "" },
  );
  assert.deepEqual(projectMessageEventContent(envelope()), {
    effect: MESSAGE_CONTENT_EFFECT.NONE,
    content: "",
  });
});
