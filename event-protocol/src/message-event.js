/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  normalizeSecurityRiskLevel,
  validateSecurityAssessment,
} from "@noobot/security-assessment-protocol";
import { text } from "./normalize.js";
import {
  THINKING_DETAIL_CONTENT_KIND,
  isThinkingDetailContentFact,
} from "./thinking-detail-content-fact.js";

export const MESSAGE_EVENT_WIRE_EVENT = "message_event";
export const MESSAGE_EVENT_SEQUENCE_DOMAIN = "message-event";

export const MESSAGE_EVENT_TYPE = Object.freeze({
  TURN_PRESENTATION_COMMITTED: "turn_presentation_committed",
  LLM_DELTA: "llm_delta",
  ACTIVITY_DELTA: "activity_delta",

  MODEL_ANALYSIS: "model_analysis_delta",
  AUTHORITATIVE_FINAL_CONTENT: "authoritative_final_content",
  THINKING: "thinking",
  TOOL_CALL_START: "tool_call_start",
  TOOL_CALL_END: "tool_call_end",
  USER_INTERJECTION: "user_interjection",
});

export const MESSAGE_EVENT_TYPES = Object.freeze(new Set(Object.values(MESSAGE_EVENT_TYPE)));

export const ACTIVITY_EVENT_TYPES = Object.freeze(
  new Set([MESSAGE_EVENT_TYPE.THINKING, MESSAGE_EVENT_TYPE.MODEL_ANALYSIS]),
);

export const ACTIVITY_KIND = Object.freeze({
  MODEL_ANALYSIS: "model_analysis",
  MAIN_MODEL_ANALYSIS: "main_model_analysis",
  MCP_MODEL_ANALYSIS: "mcp_model_analysis",
});

const HOST_ACTIVITY_KINDS = Object.freeze(new Set(Object.values(ACTIVITY_KIND)));

export function isHostActivity(activity = {}) {
  const activityKind = text(activity?.activityKind);
  return !activityKind || HOST_ACTIVITY_KINDS.has(activityKind);
}

export const TRANSIENT_MESSAGE_EVENT_TYPES = Object.freeze(
  new Set([MESSAGE_EVENT_TYPE.LLM_DELTA, MESSAGE_EVENT_TYPE.ACTIVITY_DELTA]),
);

export const TRANSIENT_MESSAGE_EVENT_SEQUENCE = 0;

export function isTransientMessageEventType(eventType = "") {
  return TRANSIENT_MESSAGE_EVENT_TYPES.has(text(eventType));
}

export function isTransientMessageEvent(envelope = {}) {
  return (
    text(envelope?.identity?.eventType) === MESSAGE_EVENT_WIRE_EVENT &&
    isTransientMessageEventType(envelope?.payload?.eventType)
  );
}

export const MODEL_MESSAGE_SCOPED_EVENT_TYPES = Object.freeze(
  new Set([
    MESSAGE_EVENT_TYPE.ACTIVITY_DELTA,
    ...ACTIVITY_EVENT_TYPES,
    MESSAGE_EVENT_TYPE.TOOL_CALL_START,
    MESSAGE_EVENT_TYPE.TOOL_CALL_END,
  ]),
);

export function resolveMessageEventModelMessageId(value = {}) {
  return text(value?.modelMessageId);
}

export const AUTHORITATIVE_FINAL_CONTENT_EVENT_TYPES = Object.freeze(
  new Set([MESSAGE_EVENT_TYPE.AUTHORITATIVE_FINAL_CONTENT]),
);

export const REPLACE_MESSAGE_CONTENT_EVENT_TYPES = Object.freeze(
  new Set([MESSAGE_EVENT_TYPE.AUTHORITATIVE_FINAL_CONTENT]),
);

export const MESSAGE_CONTENT_EFFECT = Object.freeze({
  NONE: "none",
  APPEND: "append",
  REPLACE: "replace",
});

function validatePresentationMessage(message, expectedRole, value) {
  const errors = [];
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return [`invalid_${expectedRole}_presentation`];
  }
  const messageId = text(message.messageId || message.id);
  if (!messageId) errors.push(`missing_${expectedRole}_message_id`);
  if (text(message.role) !== expectedRole) errors.push(`invalid_${expectedRole}_role`);
  if (!text(message.sessionId)) errors.push(`missing_${expectedRole}_session_id`);
  if (!text(message.turnScopeId)) errors.push(`missing_${expectedRole}_turn_scope_id`);
  if (typeof message.content !== "string") errors.push(`invalid_${expectedRole}_content`);
  if (message.attachments !== undefined && !Array.isArray(message.attachments)) {
    errors.push(`invalid_${expectedRole}_attachments`);
  }
  if (expectedRole === "assistant") {
    if (text(message.presentationMessageId) !== text(value.presentationMessageId)) {
      errors.push("assistant_presentation_id_mismatch");
    }
    if (messageId !== text(value.presentationMessageId)) {
      errors.push("assistant_message_id_mismatch");
    }
  }
  return errors;
}

function validateTurnPresentation(value) {
  const presentation = value?.presentation;
  if (!presentation || typeof presentation !== "object" || Array.isArray(presentation)) {
    return ["missing_turn_presentation"];
  }
  return [
    ...validatePresentationMessage(presentation.userMessage, "user", value),
    ...validatePresentationMessage(presentation.assistantMessage, "assistant", value),
  ];
}

function validateToolSecurityAssessment(value = {}) {
  const errors = [];
  const hasRiskLevel = value?.riskLevel !== undefined;
  const hasAssessment = value?.securityAssessment !== undefined;
  if (hasRiskLevel !== hasAssessment) {
    errors.push(hasRiskLevel ? "missing_security_assessment" : "missing_tool_risk_level");
  }
  if (!hasRiskLevel) return errors;
  if (!normalizeSecurityRiskLevel(value.riskLevel)) errors.push("invalid_tool_risk_level");
  if (!hasAssessment) return errors;
  const assessmentValidation = validateSecurityAssessment(value.securityAssessment);
  if (!assessmentValidation.valid) errors.push("invalid_security_assessment");
  if (value.securityAssessment?.effectiveRiskLevel !== value.riskLevel) {
    errors.push("security_assessment_risk_mismatch");
  }
  return errors;
}

export function resolveMessageEventPresentationId(value = {}) {
  return text(value?.presentationMessageId);
}

const NONCANONICAL_PAYLOAD_FIELDS = Object.freeze([
  "event",
  "type",
  "rawEvent",
  "tool_call_id",
  "tool_call",
  "tool_result",
  "toolCall",
  "toolResult",
  "model",
  "output",
]);

const USER_INTERJECTION_FACT_REQUIREMENTS = Object.freeze([
  ["timestamp", "missing_user_interjection_fact_timestamp"],
  ["sessionId", "missing_user_interjection_fact_session_id"],
  ["dialogProcessId", "missing_user_interjection_fact_dialog_process_id"],
  ["turnScopeId", "missing_user_interjection_fact_turn_scope_id"],
  ["messageId", "missing_user_interjection_fact_message_id"],
  ["presentationMessageId", "missing_user_interjection_fact_presentation_message_id"],
]);

const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function validatePayloadEnvelope(value) {
  const errors = NONCANONICAL_PAYLOAD_FIELDS.filter((field) => Object.hasOwn(value, field)).map(
    (field) => `noncanonical_${field}`,
  );
  if (!text(value?.presentationMessageId)) errors.push("missing_presentation_message_id");
  const workflowRunId = text(value?.workflowRunId);
  if (Boolean(workflowRunId) !== Boolean(text(value?.nodeExecutionId))) {
    errors.push("incomplete_workflow_identity");
  }
  if (workflowRunId && !text(value?.parentSessionId)) {
    errors.push("missing_workflow_parent_session");
  }
  return errors;
}

function requireEventText(value) {
  return typeof value?.text === "string" ? [] : ["missing_text"];
}

function validateActivityDelta(value) {
  const errors = requireEventText(value);
  if (!text(value?.activityId)) errors.push("missing_activity_id");
  if (!text(value?.activityKind)) errors.push("missing_activity_kind");
  if (!ACTIVITY_EVENT_TYPES.has(text(value?.activityEventType))) {
    errors.push("invalid_activity_event_type");
  }
  return errors;
}

function validateFinalContentCollections(value) {
  const errors = [];
  if (value?.attachments !== undefined && !Array.isArray(value.attachments)) {
    errors.push("invalid_attachments");
  }
  if (value?.transferEnvelopes !== undefined && !Array.isArray(value.transferEnvelopes)) {
    errors.push("invalid_transfer_envelopes");
  }
  return errors;
}

function validateUserInterjectionFact(contentFact) {
  if (!isThinkingDetailContentFact(contentFact)) return ["invalid_user_interjection_content_fact"];
  if (contentFact.contentKind !== THINKING_DETAIL_CONTENT_KIND.USER_INTERJECTION) {
    return ["invalid_user_interjection_content_kind"];
  }
  return USER_INTERJECTION_FACT_REQUIREMENTS.filter(([field]) => !text(contentFact[field])).map(
    ([, error]) => error,
  );
}

function validateUserInterjection(value) {
  const errors = validateUserInterjectionFact(value?.contentFact);
  if (!text(value?.dialogProcessId)) errors.push("missing_user_interjection_dialog_process_id");
  return errors;
}

function validateToolCallStart(value) {
  const errors = [];
  if (!text(value?.tool)) errors.push("missing_tool");
  if (!text(value?.toolCallId)) errors.push("missing_tool_call_id");
  if (value?.args !== undefined && !isPlainObject(value.args)) errors.push("invalid_tool_args");
  return [...errors, ...validateToolSecurityAssessment(value)];
}

function validateToolCallEnd(value) {
  const errors = [];
  if (!text(value?.toolCallId)) errors.push("missing_tool_call_id");
  if (!("result" in (value || {}))) errors.push("missing_tool_result");
  if (typeof value?.success !== "boolean") errors.push("missing_tool_success");
  return [...errors, ...validateToolSecurityAssessment(value)];
}

function validateEventTypeFields(value, eventType) {
  const errors = [];
  if (eventType === MESSAGE_EVENT_TYPE.TURN_PRESENTATION_COMMITTED) {
    errors.push(...validateTurnPresentation(value));
  }
  if (eventType === MESSAGE_EVENT_TYPE.LLM_DELTA) errors.push(...requireEventText(value));
  if (eventType === MESSAGE_EVENT_TYPE.ACTIVITY_DELTA) errors.push(...validateActivityDelta(value));
  if (REPLACE_MESSAGE_CONTENT_EVENT_TYPES.has(eventType) && typeof value?.text !== "string") {
    errors.push("missing_content");
  }
  if (eventType === MESSAGE_EVENT_TYPE.AUTHORITATIVE_FINAL_CONTENT) {
    errors.push(...validateFinalContentCollections(value));
  }
  if (ACTIVITY_EVENT_TYPES.has(eventType)) errors.push(...requireEventText(value));
  if (eventType === MESSAGE_EVENT_TYPE.USER_INTERJECTION) {
    errors.push(...validateUserInterjection(value));
  }
  if (eventType === MESSAGE_EVENT_TYPE.TOOL_CALL_START)
    errors.push(...validateToolCallStart(value));
  if (eventType === MESSAGE_EVENT_TYPE.TOOL_CALL_END) errors.push(...validateToolCallEnd(value));
  return errors;
}

export function validateMessageEventPayload(value) {
  if (!isPlainObject(value)) {
    return Object.freeze({
      valid: false,
      errors: Object.freeze(["payload_not_object"]),
    });
  }
  const errors = validatePayloadEnvelope(value);
  const eventType = text(value?.eventType);
  if (!MESSAGE_EVENT_TYPES.has(eventType)) errors.push("unsupported_event_type");
  errors.push(...validateEventTypeFields(value, eventType));
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function projectTurnPresentation(event = {}) {
  if (text(event?.eventType) !== MESSAGE_EVENT_TYPE.TURN_PRESENTATION_COMMITTED) {
    return null;
  }
  const presentation = event?.presentation;
  if (!presentation || typeof presentation !== "object" || Array.isArray(presentation)) {
    return null;
  }
  return Object.freeze({
    userMessage: Object.freeze({ ...presentation.userMessage }),
    assistantMessage: Object.freeze({ ...presentation.assistantMessage }),
  });
}

export function assertMessageEventPayload(value = {}) {
  const validation = validateMessageEventPayload(value);
  if (!validation.valid) {
    throw new TypeError(`invalid message event payload: ${validation.errors.join(",")}`);
  }
  return value;
}

export function projectMessageEventContent(event = {}) {
  const eventType = text(event?.eventType);
  if (eventType === MESSAGE_EVENT_TYPE.LLM_DELTA) {
    return Object.freeze({
      effect: MESSAGE_CONTENT_EFFECT.APPEND,
      content: typeof event?.text === "string" ? event.text : "",
    });
  }
  if (REPLACE_MESSAGE_CONTENT_EVENT_TYPES.has(eventType)) {
    return Object.freeze({
      effect: MESSAGE_CONTENT_EFFECT.REPLACE,
      content: typeof event?.text === "string" ? event.text : "",
    });
  }
  return Object.freeze({ effect: MESSAGE_CONTENT_EFFECT.NONE, content: "" });
}

export function projectMessageEventMetadata(event = {}) {
  const metadata = {};
  const modelAlias = text(event?.modelAlias);
  const modelName = text(event?.modelName);
  if (modelAlias) metadata.modelAlias = modelAlias;
  if (modelName) metadata.modelName = modelName;
  return Object.freeze(metadata);
}

export function projectUserInterjectionContentFact(event = {}) {
  if (
    text(event?.eventType) !== MESSAGE_EVENT_TYPE.USER_INTERJECTION ||
    !isThinkingDetailContentFact(event?.contentFact)
  ) {
    return null;
  }
  return event.contentFact;
}

export function projectAuthoritativeFinalMessage(event = {}) {
  if (!isAuthoritativeFinalContentEvent(event)) return Object.freeze({});
  const projection = {
    content: typeof event?.text === "string" ? event.text : "",
  };
  if (Array.isArray(event?.attachments) && event.attachments.length > 0) {
    projection.attachments = Object.freeze([...event.attachments]);
  }
  if (Array.isArray(event?.transferEnvelopes) && event.transferEnvelopes.length > 0) {
    projection.transferEnvelopes = Object.freeze([...event.transferEnvelopes]);
  }
  return Object.freeze(projection);
}

export function isAuthoritativeFinalContentEvent(event = {}) {
  const eventType = text(event?.eventType);
  return AUTHORITATIVE_FINAL_CONTENT_EVENT_TYPES.has(eventType);
}

export function projectMessageEventToolFacets(event = {}) {
  const eventType = text(event?.eventType);
  const toolCallId = text(event?.toolCallId);
  const assessedRiskLevel = normalizeSecurityRiskLevel(
    event?.securityAssessment?.effectiveRiskLevel,
  );
  const toolCall =
    eventType === MESSAGE_EVENT_TYPE.TOOL_CALL_START && text(event?.tool)
      ? {
          id: toolCallId,
          name: text(event.tool),
          args:
            event?.args && typeof event.args === "object" && !Array.isArray(event.args)
              ? event.args
              : {},
          ...(assessedRiskLevel ? { riskLevel: assessedRiskLevel } : {}),
        }
      : undefined;
  const toolResult =
    eventType === MESSAGE_EVENT_TYPE.TOOL_CALL_END && event?.result !== undefined
      ? {
          toolCallId,
          name: text(event?.tool),
          output: event.result,
          success: event.success,
          ...(assessedRiskLevel ? { riskLevel: assessedRiskLevel } : {}),
        }
      : undefined;
  return Object.freeze({ toolCall, toolResult });
}

export function hasMessageEventToolPayload(event = {}) {
  const { toolCall, toolResult } = projectMessageEventToolFacets(event);
  return toolCall !== undefined || toolResult !== undefined;
}
