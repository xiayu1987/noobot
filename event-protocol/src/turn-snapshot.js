/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TURN_SNAPSHOT_WIRE_EVENT, validateTurnLifecycleSnapshot } from "@noobot/session-protocol";
import { createEventEnvelope } from "./envelope.js";

export const TURN_SNAPSHOT_EVENT_FAMILY = "turn.snapshot";
export const TURN_SNAPSHOT_SCHEMA_VERSION = 1;
export const SESSION_SEQUENCE_DOMAIN = "session";

const TURN_SNAPSHOT_PRODUCER = Object.freeze({ type: "domain-service", id: "turn-snapshot-query" });

export function createTurnSnapshotEnvelope(snapshot, { eventId }) {
  const validation = validateTurnLifecycleSnapshot(snapshot);
  if (!validation.valid) {
    throw new TypeError(`invalid turn lifecycle snapshot: ${validation.errors.join(",")}`);
  }
  const sequence = snapshot.sequence;
  return createEventEnvelope({
    family: TURN_SNAPSHOT_EVENT_FAMILY,
    schemaVersion: TURN_SNAPSHOT_SCHEMA_VERSION,
    identity: {
      eventId,
      eventType: TURN_SNAPSHOT_WIRE_EVENT,
      sessionId: snapshot.sessionId,
      turnScopeId: snapshot.activeTurnScopeId || undefined,
    },
    causality: { commandId: snapshot.commandId },
    ordering: {
      domain: SESSION_SEQUENCE_DOMAIN,
      scopeId: snapshot.sessionId,
      sequence,
    },
    producer: TURN_SNAPSHOT_PRODUCER,
    occurredAt: snapshot.generatedAt,
    payload: snapshot,
  });
}

export function validateTurnSnapshotEnvelope(envelope = {}) {
  const errors = [];
  const payloadValidation = validateTurnLifecycleSnapshot(envelope?.payload);
  if (!payloadValidation.valid) errors.push(...payloadValidation.errors);
  if (envelope?.identity?.eventType !== TURN_SNAPSHOT_WIRE_EVENT)
    errors.push("invalid_snapshot_wire_event");
  if (envelope?.ordering?.domain !== SESSION_SEQUENCE_DOMAIN)
    errors.push("sequence_domain_mismatch");
  if (envelope?.ordering?.scopeId !== envelope?.identity?.sessionId)
    errors.push("sequence_scope_mismatch");
  if (envelope?.payload?.sessionId !== envelope?.identity?.sessionId)
    errors.push("snapshot_session_identity_mismatch");
  if (envelope?.payload?.sequence !== envelope?.ordering?.sequence)
    errors.push("snapshot_sequence_mismatch");
  if (envelope?.payload?.commandId !== envelope?.causality?.commandId)
    errors.push("snapshot_command_identity_mismatch");
  return { valid: errors.length === 0, errors };
}
