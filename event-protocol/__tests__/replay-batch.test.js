/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createReplayBatch, validateReplayBatch } from "../src/replay-batch.js";
import { EVENT_FAMILY, getEventFamily, validateProtocolEvent } from "../src/event-registry.js";
import { createEventEnvelope } from "../src/envelope.js";
import { INTERACTION_EVENT_TYPE, INTERACTION_SEQUENCE_DOMAIN } from "../src/interaction.js";
import { createTurnSnapshotEnvelope } from "../src/turn-snapshot.js";
import { createTurnLifecycleEventEnvelope } from "../src/turn-lifecycle-event.js";
import {
  createTurnLifecycleEnvelope,
  createTurnLifecycleSnapshot,
  TURN_EVENT,
} from "@noobot/session-protocol";

const event = (sequence, eventId = `event-${sequence}`, overrides = {}) => {
  const payload = createTurnLifecycleEnvelope({
    eventType: TURN_EVENT.PROCESSING_STARTED,
    eventId,
    commandId: `command-${sequence}`,
    sessionId: overrides.sessionId ?? "session-1",
    turnScopeId: "turn-1",
    presentationMessageId: "message-1",
    dialogProcessId: "dialog-1",
    parentSessionId: "",
    revision: sequence,
    sequence,
    phase: "processing",
    state: "processing",
    action: "send",
    executionState: "sending",
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload: overrides.payload,
  });
  return createTurnLifecycleEventEnvelope(payload, { producer: { type: "agent", id: "agent-1" } });
};

const snapshot = (sequence = 2) =>
  createTurnSnapshotEnvelope(
    createTurnLifecycleSnapshot({
      commandId: "snapshot-command",
      sessionId: "session-1",
      sequence,
      generatedAt: "2026-01-01T00:00:00.000Z",
    }),
    { eventId: `snapshot-${sequence}`, producer: { type: "agent", id: "agent-1" } },
  );

const interaction = (requestId, payloadOverrides = {}) =>
  createEventEnvelope({
    family: EVENT_FAMILY.INTERACTION_REQUEST,
    schemaVersion: getEventFamily(EVENT_FAMILY.INTERACTION_REQUEST).schemaVersion,
    identity: {
      eventId: `${requestId}-event`,
      eventType: INTERACTION_EVENT_TYPE.REQUEST,
      sessionId: "session-1",
      turnScopeId: "turn-1",
    },
    causality: {},
    ordering: { domain: INTERACTION_SEQUENCE_DOMAIN, scopeId: requestId, sequence: 1 },
    producer: { type: "agent", id: "agent-1" },
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload: {
      requestId,
      dialogProcessId: "dialog-1",
      content: "approve?",
      lifecycle: "pending",
      ...payloadOverrides,
    },
  });

const batchOf = (fields) =>
  createReplayBatch({
    sessionId: "session-1",
    snapshot: null,
    snapshotSequence: 0,
    events: [],
    pendingInteractions: [],
    ...fields,
  });

const rejection = (fields) => {
  try {
    batchOf(fields);
  } catch (error) {
    return error.message;
  }
  return "";
};

test("replay batch validates snapshot baseline and contiguous event tail", () => {
  assert.equal(validateProtocolEvent(snapshot(0)).valid, true);
  assert.throws(() => event(0), /sequence_below_family_minimum/);
  const batch = batchOf({
    snapshot: snapshot(2),
    snapshotSequence: 2,
    events: [event(3), event(4)],
  });
  assert.deepEqual(Object.keys(batch).sort(), [
    "events",
    "pendingInteractions",
    "protocol",
    "sessionId",
    "snapshot",
    "snapshotSequence",
  ]);
  assert.equal(validateReplayBatch(batch).valid, true);
  assert.equal(batchOf({ snapshotSequence: 2, events: [event(3)] }).snapshot, null);
});

test("replay batch construction rejects unordered, gapped and mismatched tails", () => {
  assert.match(
    rejection({ snapshotSequence: 2, events: [event(4), event(3)] }),
    /invalid_event_sequence/,
  );
  assert.match(
    rejection({ snapshotSequence: 2, events: [event(3), event(5)] }),
    /invalid_event_sequence/,
  );
  assert.match(
    rejection({ snapshot: snapshot(2), snapshotSequence: 1, events: [] }),
    /snapshot_sequence_mismatch/,
  );
  assert.match(rejection({ snapshot: undefined }), /envelope_not_object/);
  const foreign = rejection({ events: [event(1, "event-foreign-1", { sessionId: "session-2" })] });
  assert.match(foreign, /event_session_mismatch/);
  assert.match(foreign, /event_ordering_scope_mismatch/);
  assert.match(rejection({ events: [snapshot(1)] }), /event_family_mismatch/);
  assert.match(rejection({ snapshot: event(1), snapshotSequence: 1 }), /snapshot_family_mismatch/);
});

test("replay batch rejects duplicate event identity conflicts", () => {
  const first = event(1, "same-event");
  const second = event(2, "same-event", { payload: { state: "completed" } });
  assert.match(rejection({ events: [first, second] }), /event_identity_conflict/);
});

test("replay batch validation rejects non-protocol shapes", () => {
  const batch = batchOf({ snapshotSequence: 1 });
  assert.deepEqual(validateReplayBatch(null).errors, ["replay_batch_not_object"]);
  assert.ok(validateReplayBatch({ ...batch, cursor: {} }).errors.includes("unknown_field:cursor"));
  assert.ok(
    validateReplayBatch({ ...batch, snapshotSequence: "1" }).errors.includes(
      "invalid_snapshot_sequence",
    ),
  );
  assert.ok(
    validateReplayBatch({ ...batch, sessionId: " session-1" }).errors.includes(
      "missing_session_id",
    ),
  );
  assert.ok(
    validateReplayBatch({
      ...batch,
      protocol: { ...batch.protocol, version: "3" },
    }).errors.includes("unsupported_protocol_version"),
  );
  assert.ok(validateReplayBatch({ ...batch, events: null }).errors.includes("events_not_array"));
  assert.ok(
    validateReplayBatch({ ...batch, pendingInteractions: [{}] }).errors.includes("invalid_payload"),
  );
});

test("replay batch admits only complete pending interaction envelopes", () => {
  assert.equal(
    validateReplayBatch(batchOf({ pendingInteractions: [interaction("request-1")] })).valid,
    true,
  );
  const { lifecycle: _omitted, ...withoutLifecycle } = interaction("request-2").payload;
  const unlabeled = { ...interaction("request-2"), payload: withoutLifecycle };
  assert.match(rejection({ pendingInteractions: [unlabeled] }), /interaction_not_pending/);
  assert.match(
    rejection({
      pendingInteractions: [
        interaction("request-3", { lifecycle: "failed", resolvedBy: "system" }),
      ],
    }),
    /interaction_not_pending/,
  );
  assert.match(rejection({ pendingInteractions: [event(1)] }), /interaction_family_mismatch/);
  assert.match(
    rejection({ pendingInteractions: [{ identity: { eventType: "interaction_request" } }] }),
    /missing_event_family/,
  );
});
