/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const MESSAGE_EVENT_ENVELOPE_KIND = "noobot.message_event";
export const MESSAGE_EVENT_ENVELOPE_VERSION = 1;

const text = (value) => String(value || "").trim();

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

export function assertMessageEventEnvelope(value = {}) {
  if (!isMessageEventEnvelope(value)) {
    throw new TypeError("invalid authoritative message event envelope");
  }
  return value;
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
