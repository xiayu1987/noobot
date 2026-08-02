/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const MESSAGE_EVENT_ENVELOPE_KIND = "noobot.message_event";
export const MESSAGE_EVENT_ENVELOPE_VERSION = 2;
export const MESSAGE_EVENT_SEQUENCE_DOMAIN = "message-event";
export const MESSAGE_EVENT_SEQUENCE_SCOPE_KIND = "message";

export const MESSAGE_EVENT_TYPE = Object.freeze({
  LLM_DELTA: "llm_delta",
  MAIN_MODEL_CONTENT: "main_model_content",
  AUTHORITATIVE_FINAL_CONTENT: "authoritative_final_content",
  THINKING: "thinking",
  TOOL_CALL_START: "tool_call_start",
  TOOL_CALL_END: "tool_call_end",
});

export const MESSAGE_EVENT_TYPES = Object.freeze(new Set(Object.values(MESSAGE_EVENT_TYPE)));

export const AUTHORITATIVE_FINAL_CONTENT_EVENT_TYPES = Object.freeze(new Set([
  MESSAGE_EVENT_TYPE.AUTHORITATIVE_FINAL_CONTENT,
]));

export const REPLACE_MESSAGE_CONTENT_EVENT_TYPES = Object.freeze(new Set([
  MESSAGE_EVENT_TYPE.AUTHORITATIVE_FINAL_CONTENT,
]));

export const MESSAGE_CONTENT_EFFECT = Object.freeze({
  NONE: "none",
  APPEND: "append",
  REPLACE: "replace",
});

const text = (value) => String(value || "").trim();

export function resolveMessageEventPresentationId(value = {}) {
  return text(value?.presentationMessageId);
}

export function resolveMessageEventSequenceIdentity(value = {}) {
  const sequenceDomain = text(value?.sequenceDomain) || MESSAGE_EVENT_SEQUENCE_DOMAIN;
  const sequenceScopeId = text(value?.sequenceScopeId || value?.messageId);
  const sequence = Number(value?.sequence || 0);
  return Object.freeze({
    sequenceDomain,
    sequenceScopeKind: MESSAGE_EVENT_SEQUENCE_SCOPE_KIND,
    sequenceScopeId,
    sequence,
    sequenceKey: sequenceDomain && sequenceScopeId
      ? `${sequenceDomain}:${sequenceScopeId}`
      : "",
  });
}

export function isMessageEventEnvelope(value = {}) {
  const envelopeVersion = Number(value?.envelopeVersion);
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      value.envelopeKind === MESSAGE_EVENT_ENVELOPE_KIND &&
      envelopeVersion === MESSAGE_EVENT_ENVELOPE_VERSION &&
      text(value.eventId) &&
      text(value.eventType) &&
      text(value.sessionId) &&
      text(value.messageId) &&
      text(value.presentationMessageId) &&
      Number.isInteger(Number(value.sequence)) &&
      Number(value.sequence) > 0 &&
      text(value.timestamp),
  );
}

export function validateMessageEventEnvelope(value = {}) {
  const errors = [];
  if (!isMessageEventEnvelope(value)) errors.push("invalid_envelope_identity");
  const sequenceIdentity = resolveMessageEventSequenceIdentity(value);
  const declaredSequenceDomain = text(value?.sequenceDomain);
  const declaredSequenceScopeId = text(value?.sequenceScopeId);
  if (declaredSequenceDomain && declaredSequenceDomain !== MESSAGE_EVENT_SEQUENCE_DOMAIN) {
    errors.push("sequence_domain_mismatch");
  }
  if (declaredSequenceScopeId && declaredSequenceScopeId !== text(value?.messageId)) {
    errors.push("sequence_scope_mismatch");
  }
  if (!sequenceIdentity.sequenceKey) errors.push("missing_sequence_scope");
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
    (
      REPLACE_MESSAGE_CONTENT_EVENT_TYPES.has(eventType)
    ) &&
    typeof value?.text !== "string" &&
    typeof value?.output !== "string"
  ) errors.push("missing_content");
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
    if (!text(value?.toolCallId || value?.tool_call_id)) errors.push("missing_tool_call_id");
    if (value?.args !== undefined && (typeof value.args !== "object" || value.args === null || Array.isArray(value.args))) {
      errors.push("invalid_tool_args");
    }
  }
  if (eventType === MESSAGE_EVENT_TYPE.TOOL_CALL_END) {
    if (!text(value?.toolCallId || value?.tool_call_id)) errors.push("missing_tool_call_id");
    if (!("result" in (value || {})) && !("toolResult" in (value || {})) && !("tool_result" in (value || {}))) {
      errors.push("missing_tool_result");
    }
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function assertMessageEventEnvelope(value = {}) {
  const validation = validateMessageEventEnvelope(value);
  if (!validation.valid) {
    throw new TypeError(`invalid authoritative message event envelope: ${validation.errors.join(",")}`);
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
      content: typeof event?.text === "string"
        ? event.text
        : (typeof event?.output === "string" ? event.output : ""),
    });
  }
  return Object.freeze({ effect: MESSAGE_CONTENT_EFFECT.NONE, content: "" });
}

export function projectMessageEventMetadata(event = {}) {
  const metadata = {};
  const modelAlias = text(event?.modelAlias);
  const modelName = text(event?.modelName || event?.model);
  if (modelAlias) metadata.modelAlias = modelAlias;
  if (modelName) metadata.modelName = modelName;
  return Object.freeze(metadata);
}

export function projectAuthoritativeFinalMessage(event = {}) {
  if (!isAuthoritativeFinalContentEvent(event)) return Object.freeze({});
  return Object.freeze({
    content: typeof event?.text === "string"
      ? event.text
      : (typeof event?.output === "string" ? event.output : ""),
    attachments: Object.freeze(Array.isArray(event?.attachments) ? [...event.attachments] : []),
    transferEnvelopes: Object.freeze(
      Array.isArray(event?.transferEnvelopes) ? [...event.transferEnvelopes] : [],
    ),
  });
}

export function isAuthoritativeFinalContentEvent(event = {}) {
  const eventType = text(event?.eventType);
  return AUTHORITATIVE_FINAL_CONTENT_EVENT_TYPES.has(eventType);
}

export function projectMessageEventToolFacets(event = {}) {
  const eventType = text(event?.eventType);
  const toolCallId = text(event?.toolCallId || event?.tool_call_id);
  const explicitToolCall = event?.toolCall ?? event?.tool_call;
  const explicitToolResult = event?.toolResult ?? event?.tool_result;
  const toolCall = explicitToolCall ?? (
    eventType === "tool_call_start" && text(event?.tool)
      ? {
          id: toolCallId,
          name: text(event.tool),
          args: event?.args && typeof event.args === "object" && !Array.isArray(event.args)
            ? event.args
            : {},
        }
      : undefined
  );
  const toolResult = explicitToolResult ?? (
    eventType === "tool_call_end" && event?.result !== undefined
      ? {
          toolCallId,
          name: text(event?.tool),
          output: event.result,
          success: event?.success !== false,
        }
      : undefined
  );
  return Object.freeze({ toolCall, toolResult });
}

export function hasMessageEventToolPayload(event = {}) {
  const { toolCall, toolResult } = projectMessageEventToolFacets(event);
  return toolCall !== undefined || toolResult !== undefined;
}
