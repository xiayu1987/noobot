/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPendingInteractionReplay } from "./interaction.js";
import { validateProtocolEvent } from "./event-registry.js";

const clean = (value) => String(value || "").trim();
const eventSequence = (event = {}) => Number(event?.ordering?.sequence || 0);
const eventOrderingDomain = (event = {}) => clean(event?.ordering?.domain);
const eventOrderingScopeId = (event = {}) => clean(event?.ordering?.scopeId);
const eventSessionId = (event = {}) => clean(event?.identity?.sessionId);
const eventParentSessionId = (event = {}) => clean(event?.payload?.parentSessionId);
const eventId = (event = {}) => clean(event?.identity?.eventId);

import { EVENT_PROTOCOL_NAME, EVENT_PROTOCOL_VERSION } from "./envelope.js";
export const REPLAY_BATCH_SCHEMA = "replay.batch";

export const EVENT_CATEGORY = Object.freeze({
  AUTHORITY: "authority",
  INTERACTION: "interaction",
  DATA: "data",
  TRANSPORT: "transport",
});

export function createReplayBatch({
  sessionId = "",
  streamId = "",
  requestId = "",
  snapshot = null,
  snapshotSequence = 0,
  orderingDomain = "",
  orderingScopeId = "",
  events = [],
  pendingInteractions = [],
} = {}) {
  const normalizedOrderingDomain = clean(orderingDomain);
  const normalizedOrderingScopeId = clean(orderingScopeId);
  if (!normalizedOrderingDomain || !normalizedOrderingScopeId) {
    throw new TypeError("replay batch requires one explicit ordering stream");
  }
  const inputEvents = Array.isArray(events) ? events : [];
  for (const event of inputEvents) {
    const validation = validateProtocolEvent(event);
    if (!validation.valid) {
      throw new TypeError(`replay batch contains invalid event: ${validation.errors.join(",")}`);
    }
    if (
      eventOrderingDomain(event) !== normalizedOrderingDomain ||
      eventOrderingScopeId(event) !== normalizedOrderingScopeId
    ) {
      throw new TypeError("replay batch contains event from a different ordering stream");
    }
  }
  const normalizedEvents = [...inputEvents]
    .sort((left, right) => eventSequence(left) - eventSequence(right));
  const sequence = Number(snapshotSequence || snapshot?.sequence || 0);
  return Object.freeze({
    protocol: {
      name: EVENT_PROTOCOL_NAME,
      version: EVENT_PROTOCOL_VERSION,
      schema: REPLAY_BATCH_SCHEMA,
    },
    sessionId: clean(sessionId),
    streamId: clean(streamId),
    requestId: clean(requestId),
    snapshot,
    snapshotSequence: sequence,
    ordering: Object.freeze({
      domain: normalizedOrderingDomain,
      scopeId: normalizedOrderingScopeId,
    }),
    events: normalizedEvents,
    pendingInteractions: (Array.isArray(pendingInteractions) ? pendingInteractions : []).filter(
      (item) => item && typeof item === "object",
    ),
    cursor: {
      fromSequence: sequence,
      toSequence: normalizedEvents.reduce(
        (max, event) => Math.max(max, eventSequence(event)),
        sequence,
      ),
    },
  });
}

export function validateReplayBatch(batch = {}) {
  const errors = [];
  if (batch?.protocol?.name !== EVENT_PROTOCOL_NAME) errors.push("invalid_protocol_name");
  if (Number(batch?.protocol?.version) !== EVENT_PROTOCOL_VERSION)
    errors.push("unsupported_protocol_version");
  if (batch?.protocol?.schema !== REPLAY_BATCH_SCHEMA) errors.push("invalid_schema");
  if ("cacheExpired" in batch) errors.push("unsupported_cache_expired_branch");
  if ("expiredDialogProcessIds" in batch) errors.push("unsupported_dialog_replay_cursor");
  if (!clean(batch.sessionId)) errors.push("missing_session_id");
  const orderingDomain = clean(batch?.ordering?.domain);
  const orderingScopeId = clean(batch?.ordering?.scopeId);
  if (!orderingDomain) errors.push("missing_ordering_domain");
  if (!orderingScopeId) errors.push("missing_ordering_scope");
  if (!Number.isInteger(Number(batch.snapshotSequence)) || Number(batch.snapshotSequence) < 0) {
    errors.push("invalid_snapshot_sequence");
  }
  const snapshotSequence = Number(batch.snapshotSequence || 0);
  if (batch?.snapshot && typeof batch.snapshot === "object") {
    const snapshotValidation = validateProtocolEvent(batch.snapshot);
    if (!snapshotValidation.valid) errors.push(...snapshotValidation.errors);
    const snapshotEventSequence = eventSequence(batch.snapshot);
    if (snapshotEventSequence !== snapshotSequence) errors.push("snapshot_sequence_mismatch");
    const snapshotSessionId = eventSessionId(batch.snapshot);
    if (snapshotSessionId && snapshotSessionId !== clean(batch.sessionId)) {
      errors.push("snapshot_session_mismatch");
    }
  }
  let previous = snapshotSequence;
  const seenEventIds = new Map();
  for (const event of Array.isArray(batch.events) ? batch.events : []) {
    const eventValidation = validateProtocolEvent(event);
    if (!eventValidation.valid) errors.push(...eventValidation.errors);
    const sequence = eventSequence(event);
    if (eventOrderingDomain(event) !== orderingDomain) errors.push("event_ordering_domain_mismatch");
    if (eventOrderingScopeId(event) !== orderingScopeId) errors.push("event_ordering_scope_mismatch");
    const id = eventId(event);
    if (!id) errors.push("missing_event_id");
    if (id && seenEventIds.has(id)) {
      errors.push(
        JSON.stringify(seenEventIds.get(id)) === JSON.stringify(event)
          ? "duplicate_event_id"
          : "event_identity_conflict",
      );
    }
    if (id) seenEventIds.set(id, event);
    const sessionId = eventSessionId(event);
    if (sessionId && sessionId !== clean(batch.sessionId)) errors.push("event_session_mismatch");
    if (!Number.isInteger(sequence) || sequence !== previous + 1)
      errors.push("invalid_event_sequence");
    previous = sequence;
  }
  for (const interaction of Array.isArray(batch.pendingInteractions)
    ? batch.pendingInteractions
    : []) {
    if (!isPendingInteractionReplay(interaction)) {
      errors.push("invalid_pending_interaction");
      continue;
    }
    if (
      eventSessionId(interaction) !== clean(batch.sessionId) &&
      eventParentSessionId(interaction) !== clean(batch.sessionId)
    ) {
      errors.push("pending_interaction_session_mismatch");
    }
  }
  if (Number(batch?.cursor?.fromSequence ?? snapshotSequence) !== snapshotSequence) {
    errors.push("invalid_cursor_from_sequence");
  }
  if (Number(batch?.cursor?.toSequence ?? previous) !== previous)
    errors.push("invalid_cursor_to_sequence");
  return { valid: errors.length === 0, errors };
}

export function assertLosslessForward(original, forwarded) {
  if (original === forwarded) return true;
  const identityKeys = ["eventType", "eventId", "sessionId", "turnScopeId", "messageId", "executionId"];
  for (const key of identityKeys) {
    const originalValue = original?.identity?.[key];
    const forwardedValue = forwarded?.identity?.[key];
    if (originalValue !== forwardedValue) throw new Error(`event_forwarding_mutated_${key}`);
  }
  const originalVersion = original?.protocol?.version;
  const forwardedVersion = forwarded?.protocol?.version;
  if (originalVersion !== forwardedVersion)
    throw new Error("event_forwarding_mutated_protocolVersion");
  const orderingKeys = [
    "revision",
    "sequence",
    "aggregateVersion",
  ];
  for (const key of orderingKeys) {
    const originalValue = original?.ordering?.[key];
    const forwardedValue = forwarded?.ordering?.[key];
    if (originalValue !== undefined || forwardedValue !== undefined) {
      if (originalValue !== forwardedValue) throw new Error(`event_forwarding_mutated_${key}`);
    }
  }
  if (
    JSON.stringify(original?.payload) !== JSON.stringify(forwarded?.payload)
  ) {
    throw new Error("event_forwarding_mutated_payload");
  }
  return true;
}

export function replayEventTail({
  snapshotSequence = 0,
  orderingDomain = "",
  orderingScopeId = "",
  events = [],
  apply,
} = {}) {
  const base = Number(snapshotSequence || 0);
  const normalizedDomain = clean(orderingDomain);
  const normalizedScopeId = clean(orderingScopeId);
  if (!normalizedDomain || !normalizedScopeId) {
    return { applied: false, reason: "missing_ordering_stream" };
  }
  const inputEvents = Array.isArray(events) ? events : [];
  for (const event of inputEvents) {
    const validation = validateProtocolEvent(event);
    if (!validation.valid) {
      return { applied: false, reason: "invalid_event_envelope", errors: validation.errors };
    }
    if (
      eventOrderingDomain(event) !== normalizedDomain ||
      eventOrderingScopeId(event) !== normalizedScopeId
    ) {
      return { applied: false, reason: "event_ordering_stream_mismatch" };
    }
  }
  const ordered = inputEvents
    .filter((event) => eventSequence(event) > base)
    .sort((left, right) => eventSequence(left) - eventSequence(right));
  let previous = base;
  const appliedEventIds = new Set();
  for (const event of ordered) {
    const sequence = eventSequence(event);
    const id = eventId(event);
    if (id && appliedEventIds.has(id)) {
      return { applied: false, reason: "duplicate_event_id", eventId: id };
    }
    if (sequence !== previous + 1) {
      return {
        applied: false,
        reason: "event_sequence_gap",
        expected: previous + 1,
        actual: sequence,
      };
    }
    apply?.(event);
    if (id) appliedEventIds.add(id);
    previous = sequence;
  }
  return { applied: true, lastSequence: previous };
}
