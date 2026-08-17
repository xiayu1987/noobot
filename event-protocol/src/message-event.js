/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  normalizeSecurityRiskLevel,
  validateSecurityAssessment,
} from "@noobot/security-assessment-protocol";

export const MESSAGE_EVENT_WIRE_EVENT = "message_event";
export const MESSAGE_EVENT_SEQUENCE_DOMAIN = "message-event";

export const MESSAGE_EVENT_TYPE = Object.freeze({
  LLM_DELTA: "llm_delta",
  MAIN_MODEL_CONTENT: "main_model_content",
  AUTHORITATIVE_FINAL_CONTENT: "authoritative_final_content",
  THINKING: "thinking",
  TOOL_CALL_START: "tool_call_start",
  TOOL_CALL_END: "tool_call_end",
});

export const MESSAGE_EVENT_TYPES = Object.freeze(new Set(Object.values(MESSAGE_EVENT_TYPE)));

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

const text = (value) => String(value || "").trim();

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

/** Validates the Message domain payload. Cross-domain identity and ordering
 * belong exclusively to the Event Protocol v3 envelope. */
export function validateMessageEventPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Object.freeze({
      valid: false,
      errors: Object.freeze(["payload_not_object"]),
    });
  }
  const errors = [];
  for (const field of ["tool_call_id", "tool_call", "tool_result", "toolCall", "toolResult", "model", "output"]) {
    if (Object.hasOwn(value, field)) errors.push(`noncanonical_${field}`);
  }
  if (!text(value?.presentationMessageId)) errors.push("missing_presentation_message_id");
  const workflowRunId = text(value?.workflowRunId);
  const nodeExecutionId = text(value?.nodeExecutionId);
  if (Boolean(workflowRunId) !== Boolean(nodeExecutionId)) {
    errors.push("incomplete_workflow_identity");
  }
  if (workflowRunId && !text(value?.parentSessionId)) {
    errors.push("missing_workflow_parent_session");
  }
  const eventType = text(value?.eventType);
  if (!MESSAGE_EVENT_TYPES.has(eventType)) errors.push("unsupported_event_type");
  if (eventType === MESSAGE_EVENT_TYPE.LLM_DELTA && typeof value?.text !== "string") {
    errors.push("missing_text");
  }
  if (
    REPLACE_MESSAGE_CONTENT_EVENT_TYPES.has(eventType) &&
    typeof value?.text !== "string"
  )
    errors.push("missing_content");
  if (eventType === MESSAGE_EVENT_TYPE.AUTHORITATIVE_FINAL_CONTENT) {
    if (value?.attachments !== undefined && !Array.isArray(value.attachments)) {
      errors.push("invalid_attachments");
    }
    if (value?.transferEnvelopes !== undefined && !Array.isArray(value.transferEnvelopes)) {
      errors.push("invalid_transfer_envelopes");
    }
  }
  if (eventType === MESSAGE_EVENT_TYPE.THINKING && typeof value?.text !== "string") {
    errors.push("missing_text");
  }
  if (eventType === MESSAGE_EVENT_TYPE.TOOL_CALL_START) {
    if (!text(value?.tool)) errors.push("missing_tool");
    if (!text(value?.toolCallId)) errors.push("missing_tool_call_id");
    if (
      value?.args !== undefined &&
      (typeof value.args !== "object" || value.args === null || Array.isArray(value.args))
    ) {
      errors.push("invalid_tool_args");
    }
    errors.push(...validateToolSecurityAssessment(value));
  }
  if (eventType === MESSAGE_EVENT_TYPE.TOOL_CALL_END) {
    if (!text(value?.toolCallId)) errors.push("missing_tool_call_id");
    if (!("result" in (value || {}))) {
      errors.push("missing_tool_result");
    }
    if (typeof value?.success !== "boolean") errors.push("missing_tool_success");
    errors.push(...validateToolSecurityAssessment(value));
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function assertMessageEventPayload(value = {}) {
  const validation = validateMessageEventPayload(value);
  if (!validation.valid) {
    throw new TypeError(
      `invalid message event payload: ${validation.errors.join(",")}`,
    );
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
      content:
        typeof event?.text === "string"
          ? event.text
          : "",
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

export function projectAuthoritativeFinalMessage(event = {}) {
  if (!isAuthoritativeFinalContentEvent(event)) return Object.freeze({});
  const projection = {
    content:
      typeof event?.text === "string"
        ? event.text
        : "",
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
  const toolCall = eventType === MESSAGE_EVENT_TYPE.TOOL_CALL_START && text(event?.tool)
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
