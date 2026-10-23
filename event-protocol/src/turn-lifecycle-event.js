/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TURN_LIFECYCLE_WIRE_EVENT } from "@noobot/session-protocol";
import { createEventEnvelope } from "./envelope.js";
import { EVENT_FAMILY, getEventFamily, validateProtocolEvent } from "./event-registry.js";
import { SESSION_SEQUENCE_DOMAIN } from "./turn-snapshot.js";

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
