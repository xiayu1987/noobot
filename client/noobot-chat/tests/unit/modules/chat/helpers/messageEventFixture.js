/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  EVENT_FAMILY,
  EVENT_PROTOCOL_NAME,
  EVENT_PROTOCOL_VERSION,
} from "@noobot/event-protocol";
import {
  MESSAGE_EVENT_SEQUENCE_DOMAIN,
  MESSAGE_EVENT_WIRE_EVENT,
} from "@noobot/event-protocol/message-event";

const IDENTITY_FIELDS = new Set([
  "eventId",
  "sessionId",
  "turnScopeId",
  "messageId",
]);
const ORDERING_FIELDS = new Set([
  "sequence",
  "sequenceDomain",
  "sequenceScopeId",
  "revision",
  "aggregateVersion",
]);

/**
 * Constructs the canonical Event Protocol v3 Message Timeline envelope used at
 * client reducer boundaries. This intentionally does not call the asserting
 * protocol factory so negative validation tests can construct malformed domain
 * payloads without introducing a second wire format.
 */
export function canonicalMessageEvent(overrides = {}) {
  const eventType = overrides.eventType || "tool_call_start";
  const values = {
    eventId: "evt-1",
    eventType,
    sessionId: "session-1",
    messageId: "message-1",
    presentationMessageId: "message-1",
    sequence: 1,
    occurredAt: "2026-01-01T00:00:00.000Z",
    turnScopeId: "turn-1",
    ...(["tool_call_start", "tool_call_end"].includes(eventType)
      ? {
          tool: "read_file",
          toolCallId: "call-1",
          ...(eventType === "tool_call_start" ? { args: {} } : {}),
        }
      : {}),
    ...overrides,
  };
  const payload = {};
  for (const [key, value] of Object.entries(values)) {
    if (IDENTITY_FIELDS.has(key) || ORDERING_FIELDS.has(key) || key === "occurredAt") continue;
    payload[key] = value;
  }
  return {
    protocol: {
      name: EVENT_PROTOCOL_NAME,
      version: EVENT_PROTOCOL_VERSION,
      family: EVENT_FAMILY.MESSAGE_TIMELINE,
      schemaVersion: 1,
    },
    identity: {
      eventId: values.eventId,
      eventType: MESSAGE_EVENT_WIRE_EVENT,
      sessionId: values.sessionId,
      turnScopeId: values.turnScopeId,
      messageId: values.messageId,
    },
    causality: {},
    ordering: {
      domain: values.sequenceDomain || MESSAGE_EVENT_SEQUENCE_DOMAIN,
      scopeId: values.sequenceScopeId || values.messageId,
      sequence: values.sequence,
      ...(values.revision !== undefined ? { revision: values.revision } : {}),
      ...(values.aggregateVersion !== undefined
        ? { aggregateVersion: values.aggregateVersion }
        : {}),
    },
    producer: { type: "test", id: "client-message-event-fixture" },
    occurredAt: values.occurredAt,
    payload,
  };
}
