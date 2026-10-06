/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPendingInteractionReplay } from "./interaction.js";
import { validateProtocolEvent } from "./event-registry.js";

const eventSequence = (event = {}) => Number(event?.ordering?.sequence || 0);
const eventOrderingDomain = (event = {}) => text(event?.ordering?.domain);
const eventOrderingScopeId = (event = {}) => text(event?.ordering?.scopeId);
const eventSessionId = (event = {}) => text(event?.identity?.sessionId);
const eventParentSessionId = (event = {}) => text(event?.payload?.parentSessionId);
const eventId = (event = {}) => text(event?.identity?.eventId);

import { EVENT_PROTOCOL_NAME, EVENT_PROTOCOL_VERSION } from "./envelope.js";
import { text } from "./normalize.js";
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
  const normalizedOrderingDomain = text(orderingDomain);
  const normalizedOrderingScopeId = text(orderingScopeId);
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
  const normalizedEvents = [...inputEvents].sort(
    (left, right) => eventSequence(left) - eventSequence(right),
  );
  const sequence = Number(snapshotSequence || snapshot?.sequence || 0);
  return Object.freeze({
    protocol: {
      name: EVENT_PROTOCOL_NAME,
      version: EVENT_PROTOCOL_VERSION,
      schema: REPLAY_BATCH_SCHEMA,
    },
    sessionId: text(sessionId),
    streamId: text(streamId),
    requestId: text(requestId),
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

const listOf = (value) => (Array.isArray(value) ? value : []);

function collectReplayHeaderErrors(batch, errors) {
  const protocol = batch?.protocol;
  if (protocol?.name !== EVENT_PROTOCOL_NAME) errors.push("invalid_protocol_name");
  if (Number(protocol?.version) !== EVENT_PROTOCOL_VERSION) {
    errors.push("unsupported_protocol_version");
  }
  if (protocol?.schema !== REPLAY_BATCH_SCHEMA) errors.push("invalid_schema");
  if ("cacheExpired" in batch) errors.push("unsupported_cache_expired_branch");
  if ("expiredDialogProcessIds" in batch) errors.push("unsupported_dialog_replay_cursor");
  if (!text(batch.sessionId)) errors.push("missing_session_id");
}

function readReplayOrdering(batch, errors) {
  const domain = text(batch?.ordering?.domain);
  const scopeId = text(batch?.ordering?.scopeId);
  if (!domain) errors.push("missing_ordering_domain");
  if (!scopeId) errors.push("missing_ordering_scope");
  return { domain, scopeId };
}

function readSnapshotSequence(batch, errors) {
  const declared = Number(batch.snapshotSequence);
  if (!Number.isInteger(declared) || declared < 0) errors.push("invalid_snapshot_sequence");
  return Number(batch.snapshotSequence || 0);
}

function collectSnapshotErrors(snapshot, { snapshotSequence, sessionId }, errors) {
  if (!snapshot || typeof snapshot !== "object") return;
  const snapshotValidation = validateProtocolEvent(snapshot);
  if (!snapshotValidation.valid) errors.push(...snapshotValidation.errors);
  if (eventSequence(snapshot) !== snapshotSequence) errors.push("snapshot_sequence_mismatch");
  const snapshotSessionId = eventSessionId(snapshot);
  if (snapshotSessionId && snapshotSessionId !== sessionId) {
    errors.push("snapshot_session_mismatch");
  }
}

function collectEventIdentityErrors(event, seenEventIds, errors) {
  const id = eventId(event);
  if (!id) {
    errors.push("missing_event_id");
    return;
  }
  if (seenEventIds.has(id)) {
    errors.push(
      JSON.stringify(seenEventIds.get(id)) === JSON.stringify(event)
        ? "duplicate_event_id"
        : "event_identity_conflict",
    );
  }
  seenEventIds.set(id, event);
}

function collectEventTailErrors(events, { ordering, sessionId, snapshotSequence }, errors) {
  let previous = snapshotSequence;
  const seenEventIds = new Map();
  for (const event of listOf(events)) {
    const eventValidation = validateProtocolEvent(event);
    if (!eventValidation.valid) errors.push(...eventValidation.errors);
    const sequence = eventSequence(event);
    if (eventOrderingDomain(event) !== ordering.domain) {
      errors.push("event_ordering_domain_mismatch");
    }
    if (eventOrderingScopeId(event) !== ordering.scopeId) {
      errors.push("event_ordering_scope_mismatch");
    }
    collectEventIdentityErrors(event, seenEventIds, errors);
    const eventSession = eventSessionId(event);
    if (eventSession && eventSession !== sessionId) errors.push("event_session_mismatch");
    if (!Number.isInteger(sequence) || sequence !== previous + 1) {
      errors.push("invalid_event_sequence");
    }
    previous = sequence;
  }
  return previous;
}

function collectPendingInteractionErrors(pendingInteractions, sessionId, errors) {
  for (const interaction of listOf(pendingInteractions)) {
    if (!isPendingInteractionReplay(interaction)) {
      errors.push("invalid_pending_interaction");
      continue;
    }
    if (
      eventSessionId(interaction) !== sessionId &&
      eventParentSessionId(interaction) !== sessionId
    ) {
      errors.push("pending_interaction_session_mismatch");
    }
  }
}

function collectCursorErrors(cursor, { snapshotSequence, lastSequence }, errors) {
  if (Number(cursor?.fromSequence ?? snapshotSequence) !== snapshotSequence) {
    errors.push("invalid_cursor_from_sequence");
  }
  if (Number(cursor?.toSequence ?? lastSequence) !== lastSequence) {
    errors.push("invalid_cursor_to_sequence");
  }
}

export function validateReplayBatch(batch = {}) {
  const errors = [];
  collectReplayHeaderErrors(batch, errors);
  const ordering = readReplayOrdering(batch, errors);
  const snapshotSequence = readSnapshotSequence(batch, errors);
  const sessionId = text(batch.sessionId);
  collectSnapshotErrors(batch.snapshot, { snapshotSequence, sessionId }, errors);
  const lastSequence = collectEventTailErrors(
    batch.events,
    { ordering, sessionId, snapshotSequence },
    errors,
  );
  collectPendingInteractionErrors(batch.pendingInteractions, sessionId, errors);
  collectCursorErrors(batch.cursor, { snapshotSequence, lastSequence }, errors);
  return { valid: errors.length === 0, errors };
}

export function assertLosslessForward(original, forwarded) {
  if (original === forwarded) return true;
  const identityKeys = [
    "eventType",
    "eventId",
    "sessionId",
    "turnScopeId",
    "messageId",
    "executionId",
  ];
  for (const key of identityKeys) {
    const originalValue = original?.identity?.[key];
    const forwardedValue = forwarded?.identity?.[key];
    if (originalValue !== forwardedValue) throw new Error(`event_forwarding_mutated_${key}`);
  }
  const originalVersion = original?.protocol?.version;
  const forwardedVersion = forwarded?.protocol?.version;
  if (originalVersion !== forwardedVersion)
    throw new Error("event_forwarding_mutated_protocolVersion");
  const orderingKeys = ["revision", "sequence", "aggregateVersion"];
  for (const key of orderingKeys) {
    const originalValue = original?.ordering?.[key];
    const forwardedValue = forwarded?.ordering?.[key];
    if (originalValue !== undefined || forwardedValue !== undefined) {
      if (originalValue !== forwardedValue) throw new Error(`event_forwarding_mutated_${key}`);
    }
  }
  if (JSON.stringify(original?.payload) !== JSON.stringify(forwarded?.payload)) {
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
  const normalizedDomain = text(orderingDomain);
  const normalizedScopeId = text(orderingScopeId);
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
