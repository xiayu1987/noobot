/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isPlainObject, text } from "@noobot/shared/value";
import { selectFields } from "./normalize.js";

export const EVENT_PROTOCOL_NAME = "@noobot/event-protocol";
export const EVENT_PROTOCOL_VERSION = 3;

export function createEventId() {
  return `evt_${globalThis.crypto.randomUUID()}`;
}

export function isEventProtocolEnvelope(value = {}) {
  return isPlainObject(value) && value?.protocol?.name === EVENT_PROTOCOL_NAME;
}

export function asEventProtocolEnvelope(value = {}) {
  return isEventProtocolEnvelope(value) ? value : null;
}

const isIntegerAtLeast = (minimum) => (value) =>
  Number.isInteger(Number(value)) && Number(value) >= minimum;

const ENVELOPE_RULES = Object.freeze([
  ["protocol", "name", (value) => value === EVENT_PROTOCOL_NAME, "invalid_protocol_name"],
  [
    "protocol",
    "version",
    (value) => Number(value) === EVENT_PROTOCOL_VERSION,
    "unsupported_protocol_version",
  ],
  ["protocol", "family", text, "missing_event_family"],
  ["protocol", "schemaVersion", isIntegerAtLeast(1), "invalid_schema_version"],
  [null, "identity", isPlainObject, "invalid_identity"],
  ["identity", "eventId", text, "missing_event_id"],
  ["identity", "eventType", text, "missing_event_type"],
  ["identity", "sessionId", text, "missing_session_id"],
  [null, "causality", isPlainObject, "invalid_causality"],
  [null, "ordering", isPlainObject, "invalid_ordering"],
  ["ordering", "domain", text, "missing_ordering_domain"],
  ["ordering", "scopeId", text, "missing_ordering_scope"],
  ["ordering", "sequence", isIntegerAtLeast(0), "invalid_sequence"],
  [null, "producer", isPlainObject, "invalid_producer"],
  ["producer", "type", text, "missing_producer_type"],
  ["producer", "id", text, "missing_producer_id"],
  [null, "occurredAt", text, "missing_occurred_at"],
  [null, "payload", isPlainObject, "invalid_payload"],
]);

export function validateEventEnvelope(value = {}) {
  if (!isPlainObject(value))
    return Object.freeze({ valid: false, errors: ["envelope_not_object"] });
  const errors = ENVELOPE_RULES.filter(([section, field, predicate]) => {
    const owner = section ? value[section] : value;
    return !predicate(owner?.[field]);
  }).map(([, , , error]) => error);
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

function assertEventEnvelope(value = {}) {
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
      identity: selectFields(identity, [
        "eventId",
        "eventType",
        "sessionId",
        "turnScopeId",
        "messageId",
        "executionId",
      ]),
      causality: selectFields(causality, ["commandId", "causationId", "correlationId"]),
      ordering: selectFields(ordering, [
        "domain",
        "scopeId",
        "sequence",
        "revision",
        "aggregateVersion",
      ]),
      producer: selectFields(producer, ["type", "id"]),
      occurredAt: text(occurredAt),
      payload,
    }),
  );
}
