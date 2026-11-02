/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TURN_LIFECYCLE_WIRE_EVENT } from "@noobot/session-protocol";
import { isCanonicalText, stableValue } from "@noobot/shared/value";
import { createEventEnvelope } from "./envelope.js";
import { EVENT_FAMILY, getEventFamily, validateProtocolEvent } from "./event-registry.js";
import { SESSION_SEQUENCE_DOMAIN } from "./turn-snapshot.js";

export function mergeTurnLifecycleEvents(sessionId, events) {
  if (!isCanonicalText(sessionId) || !Array.isArray(events)) {
    throw new TypeError("invalid lifecycle merge input");
  }
  const byId = new Map();
  const bySequence = new Map();
  for (const envelope of events) {
    const validation = validateProtocolEvent(envelope);
    if (
      !validation.valid ||
      validation.descriptor.family !== EVENT_FAMILY.TURN_LIFECYCLE ||
      envelope.identity.sessionId !== sessionId
    ) {
      throw new TypeError("invalid lifecycle merge envelope");
    }
    const { eventId } = envelope.identity;
    const { sequence } = envelope.ordering;
    const existing = byId.get(eventId) || bySequence.get(sequence);
    if (existing) {
      if (JSON.stringify(stableValue(existing)) !== JSON.stringify(stableValue(envelope))) {
        throw new TypeError("lifecycle_event_conflict");
      }
      continue;
    }
    byId.set(eventId, envelope);
    bySequence.set(sequence, envelope);
  }
  return [...bySequence.values()].sort(
    (left, right) => left.ordering.sequence - right.ordering.sequence,
  );
}

export function createTurnLifecycleEventEnvelope(payload, { producer }) {
  const envelope = createEventEnvelope({
    family: EVENT_FAMILY.TURN_LIFECYCLE,
    schemaVersion: getEventFamily(EVENT_FAMILY.TURN_LIFECYCLE).schemaVersion,
    identity: {
      eventId: payload.eventId,
      eventType: TURN_LIFECYCLE_WIRE_EVENT,
      sessionId: payload.sessionId,
      turnScopeId: payload.turnScopeId,
      executionId: payload.executionId,
    },
    causality: {
      commandId: payload.commandId,
      causationId: payload.causationId,
      correlationId: payload.correlationId,
    },
    ordering: {
      domain: SESSION_SEQUENCE_DOMAIN,
      scopeId: payload.sessionId,
      sequence: payload.sequence,
      revision: payload.revision,
    },
    producer,
    occurredAt: payload.occurredAt,
    payload,
  });
  const validation = validateProtocolEvent(envelope);
  if (!validation.valid) {
    throw new TypeError(`invalid turn lifecycle event: ${validation.errors.join(",")}`);
  }
  return envelope;
}
