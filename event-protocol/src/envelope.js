/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isCanonicalText, isPlainObject } from "@noobot/shared/value";
import { selectFields } from "./normalize.js";

const ENVELOPE_SECTION_FIELDS = Object.freeze({
  identity: Object.freeze(["eventId", "eventType", "sessionId", "turnScopeId", "executionId"]),
  causality: Object.freeze(["commandId", "causationId", "correlationId"]),
  ordering: Object.freeze(["domain", "scopeId", "sequence", "revision", "aggregateVersion"]),
  producer: Object.freeze(["type", "id"]),
});

function selectSectionFields(section, source) {
  if (!isPlainObject(source)) throw new TypeError(`invalid_envelope_section: ${section}`);
  const allowed = ENVELOPE_SECTION_FIELDS[section];
  const unknown = Object.keys(source).filter((key) => !allowed.includes(key));
  if (unknown.length) {
    throw new TypeError(
      `unknown_envelope_field: ${unknown.map((k) => `${section}.${k}`).join(",")}`,
    );
  }
  return selectFields(source, allowed);
}

export const EVENT_PROTOCOL_NAME = "@noobot/event-protocol";
export const EVENT_PROTOCOL_VERSION = 3;

export function createEventId() {
  return `evt_${globalThis.crypto.randomUUID()}`;
}

export function isEventProtocolEnvelope(value) {
  return (
    isPlainObject(value) &&
    isPlainObject(value.protocol) &&
    value.protocol.name === EVENT_PROTOCOL_NAME
  );
}

export function isLegacyEventEnvelope(value) {
  if (!isPlainObject(value)) return false;
  if (!isEventProtocolEnvelope(value)) return true;
  return value.protocol.version !== EVENT_PROTOCOL_VERSION;
}

export function asEventProtocolEnvelope(value) {
  return isEventProtocolEnvelope(value) ? value : null;
}

const isIntegerAtLeast = (minimum) => (value) => Number.isInteger(value) && value >= minimum;

const ENVELOPE_RULES = Object.freeze([
  {
    section: "protocol",
    field: "name",
    predicate: (value) => value === EVENT_PROTOCOL_NAME,
    error: "invalid_protocol_name",
  },
  {
    section: "protocol",
    field: "version",
    predicate: (value) => value === EVENT_PROTOCOL_VERSION,
    error: "unsupported_protocol_version",
  },
  {
    section: "protocol",
    field: "family",
    predicate: isCanonicalText,
    error: "missing_event_family",
  },
  {
    section: "protocol",
    field: "schemaVersion",
    predicate: isIntegerAtLeast(1),
    error: "invalid_schema_version",
  },
  { field: "identity", predicate: isPlainObject, error: "invalid_identity" },
  { section: "identity", field: "eventId", predicate: isCanonicalText, error: "missing_event_id" },
  {
    section: "identity",
    field: "eventType",
    predicate: isCanonicalText,
    error: "missing_event_type",
  },
  {
    section: "identity",
    field: "sessionId",
    predicate: isCanonicalText,
    error: "missing_session_id",
  },
  { field: "causality", predicate: isPlainObject, error: "invalid_causality" },
  { field: "ordering", predicate: isPlainObject, error: "invalid_ordering" },
  {
    section: "ordering",
    field: "domain",
    predicate: isCanonicalText,
    error: "missing_ordering_domain",
  },
  {
    section: "ordering",
    field: "scopeId",
    predicate: isCanonicalText,
    error: "missing_ordering_scope",
  },
  {
    section: "ordering",
    field: "sequence",
    predicate: isIntegerAtLeast(0),
    error: "invalid_sequence",
  },
  { field: "producer", predicate: isPlainObject, error: "invalid_producer" },
  {
    section: "producer",
    field: "type",
    predicate: isCanonicalText,
    error: "missing_producer_type",
  },
  { section: "producer", field: "id", predicate: isCanonicalText, error: "missing_producer_id" },
  { field: "occurredAt", predicate: isCanonicalText, error: "missing_occurred_at" },
  { field: "payload", predicate: isPlainObject, error: "invalid_payload" },
]);

export function validateEventEnvelope(value) {
  if (!isPlainObject(value))
    return Object.freeze({ valid: false, errors: ["envelope_not_object"] });
  const errors = ENVELOPE_RULES.filter(({ section, field, predicate }) => {
    const owner = section ? value[section] : value;
    return !predicate(owner?.[field]);
  }).map(({ error }) => error);
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

function assertEventEnvelope(value) {
  const validation = validateEventEnvelope(value);
  if (!validation.valid)
    throw new TypeError(`invalid event protocol envelope: ${validation.errors.join(",")}`);
  return value;
}

export function createEventEnvelope({
  family,
  schemaVersion,
  identity,
  causality,
  ordering,
  producer,
  occurredAt,
  payload,
}) {
  return assertEventEnvelope(
    Object.freeze({
      protocol: Object.freeze({
        name: EVENT_PROTOCOL_NAME,
        version: EVENT_PROTOCOL_VERSION,
        family,
        schemaVersion,
      }),
      identity: selectSectionFields("identity", identity),
      causality: selectSectionFields("causality", causality),
      ordering: selectSectionFields("ordering", ordering),
      producer: selectSectionFields("producer", producer),
      occurredAt,
      payload,
    }),
  );
}
