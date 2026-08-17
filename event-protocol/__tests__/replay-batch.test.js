/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  createReplayBatch,
  validateReplayBatch,
  assertLosslessForward,
  replayEventTail,
} from "../src/replay-batch.js";
import { createEventEnvelope } from "../src/envelope.js";
import { EVENT_FAMILY, validateProtocolEvent } from "../src/event-registry.js";
import { createTurnSnapshotEnvelope } from "../src/turn-snapshot.js";
import {
  createTurnLifecycleEnvelope,
  createTurnLifecycleSnapshot,
  TURN_EVENT,
  TURN_LIFECYCLE_WIRE_EVENT,
} from "@noobot/session-protocol";

const event = (sequence, eventId = `event-${sequence}`, overrides = {}) => {
  const payload = createTurnLifecycleEnvelope({
    eventType: TURN_EVENT.PROCESSING_STARTED,
    eventId,
    commandId: `command-${sequence}`,
    sessionId: "session-1",
    turnScopeId: "turn-1",
    messageId: "message-1",
    presentationMessageId: "message-1",
    dialogProcessId: "dialog-1",
    revision: sequence,
    sequence,
    phase: "processing",
    state: "processing",
    action: "send",
    executionState: "sending",
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload: overrides.payload,
  });
  return createEventEnvelope({
    family: EVENT_FAMILY.TURN_LIFECYCLE,
    identity: {
      eventId,
      eventType: TURN_LIFECYCLE_WIRE_EVENT,
      sessionId: payload.sessionId,
      turnScopeId: payload.turnScopeId,
      messageId: payload.messageId,
    },
    causality: { commandId: payload.commandId },
    ordering: { domain: "session", scopeId: "session-1", sequence, revision: sequence },
    producer: { type: "agent", id: "agent-1" },
    occurredAt: payload.occurredAt,
    payload,
  });
};

const snapshot = (sequence = 2) => createTurnSnapshotEnvelope(createTurnLifecycleSnapshot({
  commandId: "snapshot-command",
  sessionId: "session-1",
  sequence,
  generatedAt: "2026-01-01T00:00:00.000Z",
}), { eventId: `snapshot-${sequence}`, producer: { type: "agent", id: "agent-1" } });

test("replay batch validates snapshot baseline and contiguous event tail", () => {
  assert.equal(validateProtocolEvent(snapshot(0)).valid, true);
  assert.ok(
    validateProtocolEvent(event(0)).errors.includes("sequence_below_family_minimum"),
  );
  const batch = createReplayBatch({
    sessionId: "session-1",
    orderingDomain: "session",
    orderingScopeId: "session-1",
    snapshotSequence: 2,
    events: [event(4), event(3)],
  });
  assert.deepEqual(
    batch.events.map((item) => item.ordering.sequence),
    [3, 4],
  );
  assert.equal(validateReplayBatch(batch).valid, true);
});

test("replay batch rejects snapshot, session and sequence violations", () => {
  const batch = createReplayBatch({
    sessionId: "session-1",
    orderingDomain: "session",
    orderingScopeId: "session-1",
    snapshotSequence: 2,
    snapshot: snapshot(2),
    events: [event(3), event(5)],
  });
  const result = validateReplayBatch(batch);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("invalid_event_sequence"));

  const foreign = createReplayBatch({
    sessionId: "session-1",
    orderingDomain: "session",
    orderingScopeId: "session-1",
    snapshotSequence: 0,
    events: [{ ...event(1), identity: { ...event(1).identity, sessionId: "session-2" } }],
  });
  assert.ok(validateReplayBatch(foreign).errors.includes("event_session_mismatch"));
});

test("replay batch rejects duplicate event identity conflicts", () => {
  const first = event(1, "same-event");
  const second = event(2, "same-event", { payload: { state: "completed" } });
  const batch = createReplayBatch({
    sessionId: "session-1",
    orderingDomain: "session",
    orderingScopeId: "session-1",
    events: [first, second],
  });
  assert.ok(validateReplayBatch(batch).errors.includes("event_identity_conflict"));
});

test("lossless forwarding accepts nested envelope and rejects identity, ordering and payload mutation", () => {
  const original = event(1);
  assert.equal(assertLosslessForward(original, structuredClone(original)), true);
  for (const mutate of [
    (copy) => {
      copy.identity.eventId = "changed";
    },
    (copy) => {
      copy.ordering.sequence = 2;
    },
    (copy) => {
      copy.payload.state = "completed";
    },
  ]) {
    const copy = structuredClone(original);
    mutate(copy);
    assert.throws(() => assertLosslessForward(original, copy), /event_forwarding_mutated_/);
  }
});

test("replayEventTail rejects duplicate identities and sequence gaps", () => {
  const applied = [];
  const result = replayEventTail({
    snapshotSequence: 1,
    orderingDomain: "session",
    orderingScopeId: "session-1",
    events: [event(2), event(2), event(3)],
    apply: (item) => applied.push(item.identity.eventId),
  });
  assert.deepEqual(applied, ["event-2"]);
  assert.deepEqual(result, { applied: false, reason: "duplicate_event_id", eventId: "event-2" });
  const gap = replayEventTail({
    snapshotSequence: 1,
    orderingDomain: "session",
    orderingScopeId: "session-1",
    events: [event(3)],
    apply() {},
  });
  assert.deepEqual(gap, { applied: false, reason: "event_sequence_gap", expected: 2, actual: 3 });
});

test("replay rejects events from another ordering stream", () => {
  const foreign = {
    ...event(1),
    ordering: { ...event(1).ordering, domain: "message", scopeId: "message-1" },
  };
  assert.throws(
    () => createReplayBatch({
      sessionId: "session-1",
      orderingDomain: "session",
      orderingScopeId: "session-1",
      events: [foreign],
    }),
    /different ordering stream/,
  );
  assert.deepEqual(replayEventTail({
    orderingDomain: "session",
    orderingScopeId: "session-1",
    events: [foreign],
    apply() {},
  }), { applied: false, reason: "event_ordering_stream_mismatch" });
});
