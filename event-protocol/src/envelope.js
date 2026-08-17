/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const EVENT_PROTOCOL_NAME = "@noobot/event-protocol";
export const EVENT_PROTOCOL_VERSION = 3;

const text = (value) => String(value || "").trim();
const isRecord = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
const select = (source, keys) =>
  Object.freeze(
    Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]])),
  );

export function validateEventEnvelope(value = {}) {
  const errors = [];
  if (!isRecord(value)) return Object.freeze({ valid: false, errors: ["envelope_not_object"] });
  if (value?.protocol?.name !== EVENT_PROTOCOL_NAME) errors.push("invalid_protocol_name");
  if (Number(value?.protocol?.version) !== EVENT_PROTOCOL_VERSION)
    errors.push("unsupported_protocol_version");
  if (!text(value?.protocol?.family)) errors.push("missing_event_family");
  if (!Number.isInteger(Number(value?.protocol?.schemaVersion)) || Number(value.protocol.schemaVersion) < 1)
    errors.push("invalid_schema_version");
  if (!isRecord(value.identity)) errors.push("invalid_identity");
  if (!text(value?.identity?.eventId)) errors.push("missing_event_id");
  if (!text(value?.identity?.eventType)) errors.push("missing_event_type");
  if (!text(value?.identity?.sessionId)) errors.push("missing_session_id");
  if (!isRecord(value.causality)) errors.push("invalid_causality");
  if (!isRecord(value.ordering)) errors.push("invalid_ordering");
  if (!text(value?.ordering?.domain)) errors.push("missing_ordering_domain");
  if (!text(value?.ordering?.scopeId)) errors.push("missing_ordering_scope");
  // Zero is the valid baseline coordinate for an empty authoritative snapshot.
  // Event-family validators decide whether a non-snapshot fact may use it.
  if (!Number.isInteger(Number(value?.ordering?.sequence)) || Number(value.ordering.sequence) < 0)
    errors.push("invalid_sequence");
  if (!isRecord(value.producer)) errors.push("invalid_producer");
  if (!text(value?.producer?.type)) errors.push("missing_producer_type");
  if (!text(value?.producer?.id)) errors.push("missing_producer_id");
  if (!text(value.occurredAt)) errors.push("missing_occurred_at");
  if (!isRecord(value.payload)) errors.push("invalid_payload");
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function assertEventEnvelope(value = {}) {
  const validation = validateEventEnvelope(value);
  if (!validation.valid)
    throw new TypeError(`invalid event protocol envelope: ${validation.errors.join(",")}`);
  return value;
}

export function createEventEnvelope({
  family,
  schemaVersion = 1,
  identity = {},
  causality = {},
  ordering = {},
  producer = {},
  occurredAt,
  payload,
} = {}) {
  return assertEventEnvelope(
    Object.freeze({
      protocol: Object.freeze({
        name: EVENT_PROTOCOL_NAME,
        version: EVENT_PROTOCOL_VERSION,
        family: text(family),
        schemaVersion: Number(schemaVersion),
      }),
      identity: select(identity, [
        "eventId",
        "eventType",
        "sessionId",
        "turnScopeId",
        "messageId",
        "executionId",
      ]),
      causality: select(causality, ["commandId", "causationId", "correlationId"]),
      ordering: select(ordering, [
        "domain",
        "scopeId",
        "sequence",
        "revision",
        "aggregateVersion",
      ]),
      producer: select(producer, ["type", "id"]),
      occurredAt: text(occurredAt),
      payload,
    }),
  );
}
