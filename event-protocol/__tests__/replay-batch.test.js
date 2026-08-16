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

const event = (sequence, eventId = `event-${sequence}`, overrides = {}) => ({
  protocol: { name: "@noobot/event-protocol", version: 1, schema: "turn.lifecycle" },
  identity: {
    eventId,
    eventType: "turn.processing_started",
    sessionId: "session-1",
    turnScopeId: "turn-1",
    commandId: `command-${sequence}`,
  },
  ordering: { streamSequence: sequence, aggregateRevision: sequence },
  payload: { state: "processing", ...overrides.payload },
});

test("replay batch validates snapshot baseline and contiguous event tail", () => {
  const batch = createReplayBatch({
    sessionId: "session-1",
    snapshotSequence: 2,
    events: [event(4), event(3)],
  });
  assert.deepEqual(
    batch.events.map((item) => item.ordering.streamSequence),
    [3, 4],
  );
  assert.equal(validateReplayBatch(batch).valid, true);
});

test("replay batch rejects snapshot, session and sequence violations", () => {
  const batch = createReplayBatch({
    sessionId: "session-1",
    snapshotSequence: 2,
    snapshot: event(2),
    events: [event(3), event(5)],
  });
  const result = validateReplayBatch(batch);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("invalid_event_sequence"));

  const foreign = createReplayBatch({
    sessionId: "session-1",
    snapshotSequence: 0,
    events: [{ ...event(1), identity: { ...event(1).identity, sessionId: "session-2" } }],
  });
  assert.ok(validateReplayBatch(foreign).errors.includes("event_session_mismatch"));
});

test("replay batch rejects duplicate event identity conflicts", () => {
  const first = event(1, "same-event");
  const second = event(2, "same-event", { payload: { state: "completed" } });
  const batch = createReplayBatch({ sessionId: "session-1", events: [first, second] });
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
      copy.ordering.streamSequence = 2;
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

test("replayEventTail applies each event once and rejects a sequence gap", () => {
  const applied = [];
  const result = replayEventTail({
    snapshotSequence: 1,
    events: [event(2), event(2), event(3)],
    apply: (item) => applied.push(item.identity.eventId),
  });
  assert.deepEqual(applied, ["event-2", "event-3"]);
  assert.equal(result.lastSequence, 3);
  const gap = replayEventTail({ snapshotSequence: 1, events: [event(3)], apply() {} });
  assert.deepEqual(gap, { applied: false, reason: "event_sequence_gap", expected: 2, actual: 3 });
});
