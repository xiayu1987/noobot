/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPendingInteractionReplay } from "./interaction.js";

const clean = (value) => String(value || "").trim();
const eventSequence = (event = {}) =>
  Number(event?.ordering?.streamSequence ?? event?.sequence ?? event?.data?.seq ?? 0);
const eventSessionId = (event = {}) =>
  clean(event?.identity?.sessionId ?? event?.sessionId ?? event?.data?.sessionId);
const eventParentSessionId = (event = {}) =>
  clean(event?.identity?.parentSessionId ?? event?.parentSessionId ?? event?.data?.parentSessionId);
const eventId = (event = {}) =>
  clean(event?.identity?.eventId ?? event?.eventId ?? event?.data?.eventId);

export const EVENT_PROTOCOL_NAME = "@noobot/event-protocol";
export const EVENT_PROTOCOL_VERSION = 2;
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
  events = [],
  pendingInteractions = [],
} = {}) {
  const normalizedEvents = (Array.isArray(events) ? events : [])
    .filter((event) => event && typeof event === "object")
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
  if (!Number.isInteger(Number(batch.snapshotSequence)) || Number(batch.snapshotSequence) < 0) {
    errors.push("invalid_snapshot_sequence");
  }
  const snapshotSequence = Number(batch.snapshotSequence || 0);
  if (batch?.snapshot && typeof batch.snapshot === "object") {
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
    const sequence = eventSequence(event);
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
  const identityKeys = ["eventType", "eventId", "commandId", "sessionId", "turnScopeId"];
  for (const key of identityKeys) {
    const originalValue = original?.identity?.[key] ?? original?.[key];
    const forwardedValue = forwarded?.identity?.[key] ?? forwarded?.[key];
    if (originalValue !== forwardedValue) throw new Error(`event_forwarding_mutated_${key}`);
  }
  const originalVersion = original?.protocol?.version ?? original?.protocolVersion;
  const forwardedVersion = forwarded?.protocol?.version ?? forwarded?.protocolVersion;
  if (originalVersion !== forwardedVersion)
    throw new Error("event_forwarding_mutated_protocolVersion");
  const orderingKeys = [
    "revision",
    "sequence",
    "aggregateRevision",
    "aggregateSequence",
    "streamSequence",
  ];
  for (const key of orderingKeys) {
    const originalValue = original?.ordering?.[key] ?? original?.[key];
    const forwardedValue = forwarded?.ordering?.[key] ?? forwarded?.[key];
    if (originalValue !== undefined || forwardedValue !== undefined) {
      if (originalValue !== forwardedValue) throw new Error(`event_forwarding_mutated_${key}`);
    }
  }
  if (
    JSON.stringify(original?.payload || original?.data || {}) !==
    JSON.stringify(forwarded?.payload || forwarded?.data || {})
  ) {
    throw new Error("event_forwarding_mutated_payload");
  }
  return true;
}

export function replayEventTail({ snapshotSequence = 0, events = [], apply } = {}) {
  const base = Number(snapshotSequence || 0);
  const ordered = (Array.isArray(events) ? events : [])
    .filter((event) => eventSequence(event) > base)
    .sort((left, right) => eventSequence(left) - eventSequence(right));
  let previous = base;
  const appliedEventIds = new Set();
  for (const event of ordered) {
    const sequence = eventSequence(event);
    const id = eventId(event);
    if (id && appliedEventIds.has(id)) continue;
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
