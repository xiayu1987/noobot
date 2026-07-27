/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const MESSAGE_EVENT_ENVELOPE_KIND = "noobot.message_event";
export const MESSAGE_EVENT_ENVELOPE_VERSION = 1;
export const MESSAGE_EVENT_SEQUENCE_DOMAIN = "message-event";
export const MESSAGE_EVENT_SEQUENCE_SCOPE_KIND = "message";

export const MESSAGE_EVENT_TYPE = Object.freeze({
  LLM_DELTA: "llm_delta",
  MAIN_MODEL_CONTENT: "main_model_content",
  THINKING: "thinking",
  TOOL_CALL_START: "tool_call_start",
  TOOL_CALL_END: "tool_call_end",
});

export const MESSAGE_EVENT_TYPES = Object.freeze(new Set(Object.values(MESSAGE_EVENT_TYPE)));

export const MESSAGE_CONTENT_EFFECT = Object.freeze({
  NONE: "none",
  APPEND: "append",
  REPLACE: "replace",
});

const text = (value) => String(value || "").trim();

/**
 * Message-event ordering is never global to a Session or Turn. The complete
 * cursor identity is (domain, scopeId, sequence), where scopeId is messageId.
 * `sequenceScopeId` is explicit on new envelopes; messageId is the v1 replay
 * fallback for persisted envelopes produced before that field existed.
 */
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
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      value.envelopeKind === MESSAGE_EVENT_ENVELOPE_KIND &&
      Number(value.envelopeVersion) === MESSAGE_EVENT_ENVELOPE_VERSION &&
      text(value.eventId) &&
      text(value.eventType) &&
      text(value.sessionId) &&
      text(value.messageId) &&
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
  const eventType = text(value?.eventType);
  if (!MESSAGE_EVENT_TYPES.has(eventType)) errors.push("unsupported_event_type");
  if (eventType === MESSAGE_EVENT_TYPE.LLM_DELTA && typeof value?.text !== "string") {
    errors.push("missing_text");
  }
  if (
    eventType === MESSAGE_EVENT_TYPE.MAIN_MODEL_CONTENT &&
    typeof value?.text !== "string" &&
    typeof value?.output !== "string"
  ) errors.push("missing_content");
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

/**
 * Project only the content effect of a canonical message event. Main-session
 * and workflow child projections share this contract, so streaming changes
 * delivery timing but never the final message semantics.
 */
export function projectMessageEventContent(event = {}) {
  const eventType = text(event?.eventType);
  if (eventType === MESSAGE_EVENT_TYPE.LLM_DELTA) {
    return Object.freeze({
      effect: MESSAGE_CONTENT_EFFECT.APPEND,
      content: typeof event?.text === "string" ? event.text : "",
    });
  }
  if (eventType === MESSAGE_EVENT_TYPE.MAIN_MODEL_CONTENT) {
    return Object.freeze({
      effect: MESSAGE_CONTENT_EFFECT.REPLACE,
      content: typeof event?.text === "string"
        ? event.text
        : (typeof event?.output === "string" ? event.output : ""),
    });
  }
  return Object.freeze({ effect: MESSAGE_CONTENT_EFFECT.NONE, content: "" });
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
