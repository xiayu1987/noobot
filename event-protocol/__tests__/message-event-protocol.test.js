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
import { createEventEnvelope, getEventFamily } from "@noobot/event-protocol";
import {
  ACTIVITY_KIND,
  MESSAGE_EVENT_TYPE,
  MESSAGE_CONTENT_EFFECT,
  MESSAGE_EVENT_WIRE_EVENT,
  isAuthoritativeFinalContentEvent,
  isHostActivity,
  projectMessageEventContent,
  projectTurnPresentation,
  resolveMessageEventPresentationId,
  resolveMessageViewKey,
  validateMessageEventPayload,
} from "@noobot/event-protocol/message-event";
import { EVENT_FAMILY, validateProtocolEvent } from "../src/event-registry.js";
import { MESSAGE_REMOVED_FIELD_NAME } from "@noobot/session-protocol";
import {
  createFileDiff,
  createFileMutationResult,
  projectMutationRefs,
} from "@noobot/file-mutation-protocol";

const LEGACY_MESSAGE_ID = MESSAGE_REMOVED_FIELD_NAME.MESSAGE_ID;
const OK_RESULT = JSON.stringify({ ok: true });

function payload(overrides = {}) {
  return {
    eventType: MESSAGE_EVENT_TYPE.TOOL_CALL_START,
    presentationMessageId: "presentation-1",
    dialogProcessId: "dialog-1",
    tool: "read_file",
    toolCallId: "call-1",
    args: {},
    ...overrides,
  };
}

function envelope(payloadOverrides = {}, envelopeOverrides = {}) {
  return createEventEnvelope({
    family: EVENT_FAMILY.MESSAGE_TIMELINE,
    schemaVersion: getEventFamily(EVENT_FAMILY.MESSAGE_TIMELINE).schemaVersion,
    identity: {
      eventId: "event-1",
      eventType: MESSAGE_EVENT_WIRE_EVENT,
      sessionId: "child-1",
      turnScopeId: "turn-1",
      ...(envelopeOverrides.identity || {}),
    },
    causality: { ...(envelopeOverrides.causality || {}) },
    ordering: {
      domain: "message-event",
      scopeId: "presentation-1",
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
  assert.deepEqual(validateProtocolEvent(envelope({}, { ordering: { sequence: 0 } })).errors, [
    "durable_event_unsequenced",
  ]);
  assert.throws(
    () => envelope({}, { identity: { [LEGACY_MESSAGE_ID]: "message-1" } }),
    new RegExp(`unknown_envelope_field: identity\\.${LEGACY_MESSAGE_ID}`),
  );
  assert.deepEqual(
    validateProtocolEvent(envelope({}, { ordering: { scopeId: "message-2" } })).errors,
    ["sequence_scope_mismatch"],
  );
  assert.deepEqual(validateProtocolEvent(envelope({}, { ordering: { revision: 1 } })).errors, [
    "message_ordering_revision_forbidden",
  ]);
  assert.deepEqual(
    validateProtocolEvent(envelope({}, { ordering: { aggregateVersion: 1 } })).errors,
    ["message_ordering_aggregateVersion_forbidden"],
  );
  assert.deepEqual(
    validateProtocolEvent(envelope({}, { identity: { turnScopeId: " turn-1 " } })).errors,
    ["missing_turn_scope_id"],
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

test("message payload validation is total for non-object input", () => {
  for (const value of [null, undefined, "invalid", []]) {
    assert.deepEqual(validateMessageEventPayload(value), {
      valid: false,
      errors: ["payload_not_object"],
    });
  }
});

test("user interjection events carry one canonical thinking content fact", () => {
  const commandId = "command-1";
  const contentFact = {
    contentId: "message:interjection-uid-1",
    contentKind: "user_interjection",
    sourceMessageUid: "interjection-uid-1",
    text: "apply the accepted constraint",
    timestamp: "2026-09-18T01:00:00.000Z",
    sequence: 1,
    sessionId: "child-1",
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
    presentationMessageId: "presentation-1",
  };
  const interjection = envelope(
    {
      eventType: MESSAGE_EVENT_TYPE.USER_INTERJECTION,
      dialogProcessId: "dialog-1",
      contentFact,
      tool: undefined,
      toolCallId: undefined,
    },
    { causality: { commandId, causationId: commandId } },
  );

  assert.equal(validateProtocolEvent(interjection).valid, true);
  assert.deepEqual(
    validateProtocolEvent({
      ...interjection,
      payload: {
        ...interjection.payload,
        contentFact: { ...contentFact, sourceMessageUid: "interjection-uid-other" },
      },
    }).errors,
    ["interjection_content_identity_mismatch"],
  );
  assert.deepEqual(
    validateProtocolEvent({
      ...interjection,
      causality: { ...interjection.causality, causationId: "command-other" },
    }).errors,
    ["interjection_causation_identity_mismatch"],
  );
  assert.deepEqual(
    validateMessageEventPayload({
      ...interjection.payload,
      dialogProcessId: "",
      contentFact: {
        ...contentFact,
        timestamp: "",
        dialogProcessId: "",
      },
    }).errors,
    [
      "missing_dialog_process_id",
      "missing_user_interjection_fact_timestamp",
      "missing_user_interjection_fact_dialog_process_id",
    ],
  );
  assert.deepEqual(
    validateMessageEventPayload({
      ...interjection.payload,
      contentFact: { ...contentFact, sequence: "1" },
    }).errors,
    ["invalid_user_interjection_content_fact"],
  );
  assert.deepEqual(
    validateMessageEventPayload({
      ...interjection.payload,
      contentFact: { ...contentFact, sessionId: " child-1" },
    }).errors,
    ["missing_user_interjection_fact_session_id"],
  );
  assert.deepEqual(
    validateProtocolEvent({
      ...interjection,
      causality: { commandId: " command-1", causationId: " command-1" },
    }).errors,
    ["missing_interjection_command_id"],
  );
});

test("message payload owns presentation identity and content semantics", () => {
  const current = payload();
  assert.equal(resolveMessageEventPresentationId(current), "presentation-1");
  assert.equal(
    isAuthoritativeFinalContentEvent(payload({ eventType: "model_analysis_delta" })),
    false,
  );
  assert.equal(
    isAuthoritativeFinalContentEvent(payload({ eventType: "authoritative_final_content" })),
    true,
  );
  assert.deepEqual(validateMessageEventPayload(payload({ presentationMessageId: "" })).errors, [
    "missing_presentation_message_id",
  ]);
  assert.deepEqual(projectMessageEventContent(payload({ eventType: "llm_delta", text: "token" })), {
    effect: MESSAGE_CONTENT_EFFECT.APPEND,
    content: "token",
  });
  assert.deepEqual(projectMessageEventContent(payload()), {
    effect: MESSAGE_CONTENT_EFFECT.NONE,
    content: "",
  });
});

test("turn presentation atomically declares canonical user and assistant entities", () => {
  const presentation = {
    userMessage: {
      messageUid: "sm_user-1",
      userMessageId: "user-1",
      role: "user",
      sessionId: "child-1",
      turnScopeId: "turn-1",
      content: "question",
      attachments: [],
      ts: "2026-01-01T00:00:00.000Z",
    },
    assistantMessage: {
      presentationMessageId: "presentation-1",
      role: "assistant",
      sessionId: "child-1",
      turnScopeId: "turn-1",
      content: "",
      attachments: [],
    },
  };
  const committed = payload({
    eventType: MESSAGE_EVENT_TYPE.TURN_PRESENTATION_COMMITTED,
    presentation,
    tool: undefined,
    toolCallId: undefined,
  });

  assert.deepEqual(validateMessageEventPayload(committed), { valid: true, errors: [] });
  const committedEnvelope = envelope(committed);
  assert.deepEqual(validateProtocolEvent(committedEnvelope).valid, true);
  assert.deepEqual(projectTurnPresentation(committedEnvelope), {
    userMessage: presentation.userMessage,
    assistantMessage: { ...presentation.assistantMessage, ts: committedEnvelope.occurredAt },
  });
  assert.throws(
    () => projectTurnPresentation(envelope(payload({ eventType: MESSAGE_EVENT_TYPE.LLM_DELTA }))),
    /requires turn_presentation_committed/,
  );
  const { ts: _userTs, ...userWithoutTs } = presentation.userMessage;
  const { attachments: _assistantAttachments, ...assistantWithoutAttachments } =
    presentation.assistantMessage;
  assert.deepEqual(
    validateMessageEventPayload({
      ...committed,
      presentation: {
        userMessage: userWithoutTs,
        assistantMessage: { ...assistantWithoutAttachments, ts: "2026-01-01T00:00:00.000Z" },
      },
    }).errors,
    ["missing_user_ts", "invalid_assistant_attachments", "noncanonical_assistant_ts"],
  );
  assert.deepEqual(
    validateProtocolEvent(
      envelope({
        ...committed,
        presentation: {
          ...presentation,
          userMessage: { ...presentation.userMessage, sessionId: "another-session" },
        },
      }),
    ).errors,
    ["user_session_identity_mismatch"],
  );
  assert.deepEqual(
    validateMessageEventPayload({
      ...committed,
      presentation: {
        ...presentation,
        assistantMessage: { ...presentation.assistantMessage, [LEGACY_MESSAGE_ID]: "split-id" },
      },
    }).errors,
    ["noncanonical_assistant_message_id"],
  );
  const { messageUid: _omitted, ...userWithoutUid } = presentation.userMessage;
  assert.deepEqual(
    validateMessageEventPayload({
      ...committed,
      presentation: { ...presentation, userMessage: userWithoutUid },
    }).errors,
    ["missing_user_message_uid"],
  );
  assert.deepEqual(
    validateMessageEventPayload({
      ...committed,
      presentation: {
        userMessage: { ...presentation.userMessage, id: "user-1" },
        assistantMessage: { ...presentation.assistantMessage, id: "presentation-1" },
      },
    }).errors,
    ["noncanonical_user_id", "noncanonical_assistant_id"],
  );
});

test("message payload validates tool facts", () => {
  assert.deepEqual(validateMessageEventPayload(payload({ args: {} })), { valid: true, errors: [] });
  assert.deepEqual(
    validateMessageEventPayload(
      payload({ eventType: MESSAGE_EVENT_TYPE.LLM_DELTA, text: "token" }),
    ),
    { valid: true, errors: [] },
  );
  const endedPayload = payload({
    eventType: MESSAGE_EVENT_TYPE.TOOL_CALL_END,
    result: OK_RESULT,
    success: true,
    durationMs: 5,
  });
  assert.deepEqual(validateMessageEventPayload(endedPayload), { valid: true, errors: [] });
  assert.deepEqual(validateMessageEventPayload({ ...endedPayload, tool: undefined }).errors, [
    "missing_tool",
  ]);
  for (const args of [undefined, null, "{}", []]) {
    assert.deepEqual(validateMessageEventPayload(payload({ args })).errors, ["invalid_tool_args"]);
  }
  for (const result of [
    undefined,
    "body",
    JSON.stringify({ data: 1 }),
    JSON.stringify([]),
    { ok: true },
  ]) {
    assert.deepEqual(validateMessageEventPayload({ ...endedPayload, result }).errors, [
      "invalid_tool_result",
    ]);
  }
});

test("tool_call_end requires a finite non-negative durationMs", () => {
  const ended = (fields) =>
    payload({
      eventType: MESSAGE_EVENT_TYPE.TOOL_CALL_END,
      result: OK_RESULT,
      success: true,
      ...fields,
    });
  assert.deepEqual(validateMessageEventPayload(ended({ durationMs: 0 })), {
    valid: true,
    errors: [],
  });
  for (const durationMs of [undefined, -1, Number.NaN, "5"]) {
    assert.deepEqual(validateMessageEventPayload(ended({ durationMs })).errors, [
      "invalid_tool_duration",
    ]);
  }
});

test("tool_call_end accepts resourceRefs arrays and rejects other shapes", () => {
  const ended = (fields) =>
    payload({
      eventType: MESSAGE_EVENT_TYPE.TOOL_CALL_END,
      result: OK_RESULT,
      success: true,
      durationMs: 1,
      ...fields,
    });
  assert.equal(validateMessageEventPayload(ended({ resourceRefs: [] })).valid, true);
  for (const resourceRefs of [{}, "res_1", null]) {
    assert.deepEqual(validateMessageEventPayload(ended({ resourceRefs })).errors, [
      "invalid_resource_refs",
    ]);
  }
});

function validMutationRef() {
  const id = "11111111-1111-4111-8111-111111111111";
  const meta = (section, sha256) => ({
    exists: true,
    isText: true,
    size: 4,
    sha256,
    snapshotRef: { mutationId: id, section },
  });
  const [ref] = projectMutationRefs(
    createFileMutationResult({
      id,
      operation: "update",
      locator: { view: "workspace", path: "src/example.js" },
      fileName: "example.js",
      before: meta("before", "before"),
      after: meta("after", "after"),
      diff: createFileDiff("old\n", "new\n"),
      sessionScope: null,
    }),
  );
  return ref;
}

test("tool_call_end accepts canonical mutationRefs and rejects other shapes", () => {
  const ended = (fields) =>
    payload({
      eventType: MESSAGE_EVENT_TYPE.TOOL_CALL_END,
      result: OK_RESULT,
      success: true,
      durationMs: 1,
      ...fields,
    });
  assert.equal(validateMessageEventPayload(ended({ mutationRefs: [] })).valid, true);
  assert.equal(
    validateMessageEventPayload(ended({ mutationRefs: [validMutationRef()] })).valid,
    true,
  );
  const broken = { ...validMutationRef(), revision: 0 };
  for (const mutationRefs of [{}, null, "m_1", [broken], [{ mutationId: "m_1" }]]) {
    assert.deepEqual(validateMessageEventPayload(ended({ mutationRefs })).errors, [
      "invalid_mutation_refs",
    ]);
  }
});

test("tool_call_end requires transferEnvelopes to be an array when present", () => {
  const ended = (fields) =>
    payload({
      eventType: MESSAGE_EVENT_TYPE.TOOL_CALL_END,
      result: OK_RESULT,
      success: true,
      durationMs: 1,
      ...fields,
    });
  assert.equal(validateMessageEventPayload(ended({})).valid, true);
  assert.equal(validateMessageEventPayload(ended({ transferEnvelopes: [] })).valid, true);
  for (const transferEnvelopes of [{}, null, "envelope"]) {
    assert.deepEqual(validateMessageEventPayload(ended({ transferEnvelopes })).errors, [
      "invalid_transfer_envelopes",
    ]);
  }
});

test("message payload rejects nested and aliased tool facts", () => {
  const noncanonical = payload({
    eventType: MESSAGE_EVENT_TYPE.TOOL_CALL_END,
    result: OK_RESULT,
    success: false,
    durationMs: 5,
    toolResult: { tool_call_id: "call-1", output: { ok: true }, success: true },
  });
  assert.deepEqual(validateMessageEventPayload(noncanonical).errors, ["noncanonical_toolResult"]);
  assert.deepEqual(validateMessageEventPayload(payload({ tool_call_id: "call-1" })).errors, [
    "noncanonical_tool_call_id",
  ]);
});

test("message activity payload rejects presentation aliases and preserves an explicit discriminator", () => {
  assert.deepEqual(
    validateMessageEventPayload(
      payload({
        eventType: MESSAGE_EVENT_TYPE.THINKING,
        tool: undefined,
        toolCallId: undefined,
        text: "analysis",
        activityId: "activity-1",
        activityKind: "guidance_analysis",
        event: "guidance_analysis_response",
        type: "guidance_analysis",
        rawEvent: "plugin_capability_response",
      }),
    ).errors,
    ["noncanonical_event", "noncanonical_type", "noncanonical_rawEvent"],
  );
  assert.deepEqual(
    validateMessageEventPayload(
      payload({
        eventType: MESSAGE_EVENT_TYPE.THINKING,
        tool: undefined,
        toolCallId: undefined,
        text: "analysis",
        activityId: "activity-1",
        activityKind: "guidance_analysis",
      }),
    ),
    { valid: true, errors: [] },
  );
});

test("durable activity payload requires activity identity", () => {
  for (const eventType of [MESSAGE_EVENT_TYPE.THINKING, MESSAGE_EVENT_TYPE.MODEL_ANALYSIS]) {
    const base = { eventType, tool: undefined, toolCallId: undefined, text: "analysis" };
    assert.deepEqual(
      validateMessageEventPayload(payload({ ...base, activityKind: "guidance_analysis" })).errors,
      ["missing_activity_id"],
    );
    assert.deepEqual(
      validateMessageEventPayload(payload({ ...base, activityId: "activity-1" })).errors,
      ["missing_activity_kind"],
    );
  }
});

test("message payload validates canonical tool risk", () => {
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
    result: OK_RESULT,
    success: true,
    durationMs: 5,
    riskLevel: "high",
    securityAssessment: raisedAssessment,
  });
  assert.deepEqual(validateMessageEventPayload(started), { valid: true, errors: [] });
  assert.deepEqual(validateMessageEventPayload(ended), { valid: true, errors: [] });
});

test("isHostActivity accepts empty and host kinds and rejects plugin kinds", () => {
  assert.equal(isHostActivity({}), true);
  assert.equal(isHostActivity({ activityKind: " " }), true);
  for (const activityKind of Object.values(ACTIVITY_KIND)) {
    assert.equal(isHostActivity({ activityKind }), true);
  }
  assert.equal(isHostActivity({ activityKind: "guidance_analysis" }), false);
});

test("message view key resolves by role without fallback", () => {
  assert.equal(
    resolveMessageViewKey({
      role: "assistant",
      messageUid: "sm_a",
      presentationMessageId: "presentation-1",
    }),
    "presentation-1",
  );
  assert.equal(resolveMessageViewKey({ role: "assistant", messageUid: "sm_a" }), "");
  assert.equal(resolveMessageViewKey({ role: "assistant", [LEGACY_MESSAGE_ID]: "stream-1" }), "");
  for (const role of ["user", "tool", "system"]) {
    assert.equal(
      resolveMessageViewKey({ role, messageUid: "sm_x", presentationMessageId: "pm_x" }),
      "sm_x",
    );
    assert.equal(
      resolveMessageViewKey({ role, userMessageId: "um_x", [LEGACY_MESSAGE_ID]: "sm_x" }),
      "",
    );
  }
});
