/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, isPlainObject } from "@noobot/shared/value";
import { INTERACTION_LIFECYCLE } from "./interaction.js";
import { EVENT_FAMILY, validateProtocolEvent } from "./event-registry.js";
import { EVENT_PROTOCOL_NAME, EVENT_PROTOCOL_VERSION } from "./envelope.js";
import { SESSION_SEQUENCE_DOMAIN } from "./turn-snapshot.js";

const REPLAY_BATCH_SCHEMA = "replay.batch";
const REPLAY_BATCH_KEYS = new Set([
  "protocol",
  "sessionId",
  "snapshot",
  "snapshotSequence",
  "events",
  "pendingInteractions",
]);

function collectHeaderErrors(batch, errors) {
  for (const key of Object.keys(batch)) {
    if (!REPLAY_BATCH_KEYS.has(key)) errors.push(`unknown_field:${key}`);
  }
  const { protocol } = batch;
  if (!isPlainObject(protocol)) {
    errors.push("invalid_protocol");
    return;
  }
  if (protocol.name !== EVENT_PROTOCOL_NAME) errors.push("invalid_protocol_name");
  if (protocol.version !== EVENT_PROTOCOL_VERSION) errors.push("unsupported_protocol_version");
  if (protocol.schema !== REPLAY_BATCH_SCHEMA) errors.push("invalid_schema");
  if (!isCanonicalText(batch.sessionId)) errors.push("missing_session_id");
  if (!Number.isInteger(batch.snapshotSequence) || batch.snapshotSequence < 0) {
    errors.push("invalid_snapshot_sequence");
  }
}

function collectSessionStreamErrors(envelope, sessionId, errors, prefix) {
  if (envelope.identity.sessionId !== sessionId) errors.push(`${prefix}_session_mismatch`);
  if (envelope.ordering.domain !== SESSION_SEQUENCE_DOMAIN) {
    errors.push(`${prefix}_ordering_domain_mismatch`);
  }
  if (envelope.ordering.scopeId !== sessionId) errors.push(`${prefix}_ordering_scope_mismatch`);
}

function collectFamilyErrors(envelope, family, errors, prefix) {
  const validation = validateProtocolEvent(envelope);
  if (!validation.valid) {
    errors.push(...validation.errors);
    return false;
  }
  if (validation.descriptor.family !== family) {
    errors.push(`${prefix}_family_mismatch`);
    return false;
  }
  return true;
}

function collectSnapshotErrors(batch, errors) {
  const { snapshot, snapshotSequence, sessionId } = batch;
  if (snapshot === null) return;
  if (!collectFamilyErrors(snapshot, EVENT_FAMILY.TURN_SNAPSHOT, errors, "snapshot")) return;
  collectSessionStreamErrors(snapshot, sessionId, errors, "snapshot");
  if (snapshot.ordering.sequence !== snapshotSequence) errors.push("snapshot_sequence_mismatch");
}

function collectEventIdentityErrors(event, seenEventIds, errors) {
  const id = event.identity.eventId;
  if (seenEventIds.has(id)) {
    errors.push(
      JSON.stringify(seenEventIds.get(id)) === JSON.stringify(event)
        ? "duplicate_event_id"
        : "event_identity_conflict",
    );
  }
  seenEventIds.set(id, event);
}

function collectEventTailErrors(batch, errors) {
  const { events, sessionId, snapshotSequence } = batch;
  if (!Array.isArray(events)) {
    errors.push("events_not_array");
    return;
  }
  let previous = snapshotSequence;
  const seenEventIds = new Map();
  for (const event of events) {
    if (!collectFamilyErrors(event, EVENT_FAMILY.TURN_LIFECYCLE, errors, "event")) continue;
    collectSessionStreamErrors(event, sessionId, errors, "event");
    collectEventIdentityErrors(event, seenEventIds, errors);
    if (event.ordering.sequence !== previous + 1) errors.push("invalid_event_sequence");
    previous = event.ordering.sequence;
  }
}

function collectPendingInteractionErrors(batch, errors) {
  const { pendingInteractions, sessionId } = batch;
  if (!Array.isArray(pendingInteractions)) {
    errors.push("pending_interactions_not_array");
    return;
  }
  for (const interaction of pendingInteractions) {
    if (
      !collectFamilyErrors(interaction, EVENT_FAMILY.INTERACTION_REQUEST, errors, "interaction")
    ) {
      continue;
    }
    if (interaction.payload.lifecycle !== INTERACTION_LIFECYCLE.PENDING) {
      errors.push("interaction_not_pending");
    }
    if (
      interaction.identity.sessionId !== sessionId &&
      interaction.payload.parentSessionId !== sessionId
    ) {
      errors.push("pending_interaction_session_mismatch");
    }
  }
}

export function validateReplayBatch(batch) {
  if (!isPlainObject(batch)) return { valid: false, errors: ["replay_batch_not_object"] };
  const errors = [];
  collectHeaderErrors(batch, errors);
  if (errors.length) return { valid: false, errors };
  collectSnapshotErrors(batch, errors);
  collectEventTailErrors(batch, errors);
  collectPendingInteractionErrors(batch, errors);
  return { valid: errors.length === 0, errors };
}

export function createReplayBatch({
  sessionId,
  snapshot,
  snapshotSequence,
  events,
  pendingInteractions,
}) {
  const batch = Object.freeze({
    protocol: Object.freeze({
      name: EVENT_PROTOCOL_NAME,
      version: EVENT_PROTOCOL_VERSION,
      schema: REPLAY_BATCH_SCHEMA,
    }),
    sessionId,
    snapshot,
    snapshotSequence,
    events,
    pendingInteractions,
  });
  const validation = validateReplayBatch(batch);
  if (!validation.valid) {
    throw new TypeError(`invalid replay batch: ${validation.errors.join(",")}`);
  }
  return batch;
}
