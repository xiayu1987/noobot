/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTACHMENT_LIFECYCLE_SEQUENCE_DOMAIN,
  attachmentLifecycleSequenceScopeId,
  createAttachmentLifecycleEvent,
} from "@noobot/attachment-protocol";
import {
  createEventEnvelope,
  EVENT_FAMILY,
  readProtocolEventReducerInput,
  reduceAttachmentLifecycle,
  requireAttachmentLifecycleEnvelope,
  validateProtocolEvent,
} from "../src/index.js";
import { migrateAttachmentLifecycleOutboxRecords } from "../src/attachment-lifecycle-migration.js";
import { projectAuthorityOutboxJournal } from "../src/authority-event-outbox.js";

const identity = { attachmentId: "a1", sessionId: "s1", attachmentSource: "user" };
function envelope(eventId = "e1", type = "received", sequence = 1) {
  return createEventEnvelope({
    family: EVENT_FAMILY.ATTACHMENT_LIFECYCLE,
    schemaVersion: 2,
    identity: { eventId, eventType: "attachment_lifecycle", sessionId: "s1", turnScopeId: "t1" },
    causality: { correlationId: "r1" },
    ordering: {
      domain: ATTACHMENT_LIFECYCLE_SEQUENCE_DOMAIN,
      scopeId: attachmentLifecycleSequenceScopeId(identity),
      sequence,
    },
    producer: { type: "test", id: "attachment-test" },
    occurredAt: "2026-11-01T00:00:01.000Z",
    payload: createAttachmentLifecycleEvent({
      eventType: `attachment.${type}`,
      eventVersion: 2,
      identity,
      status: type,
      turnScopeId: "t1",
      occurredAt: "2026-11-01T00:00:00.000Z",
    }),
  });
}
function legacyCommit(eventId = "e1", legacyId = "old-1") {
  const current = envelope(eventId);
  return {
    op: "commit",
    eventId,
    committedAt: current.occurredAt,
    envelope: {
      ...current,
      protocol: { ...current.protocol, schemaVersion: 1 },
      payload: { ...current.payload, eventVersion: 1, attachmentEventId: legacyId },
    },
  };
}

test("attachment reducer receives the same authority identity in live, persisted and replay inputs", () => {
  const first = envelope();
  assert.equal(readProtocolEventReducerInput(first).input, first);
  const state = reduceAttachmentLifecycle(undefined, first);
  assert.equal(state.events[0].identity.eventId, first.identity.eventId);
  assert.equal(Object.hasOwn(state.events[0].payload, "attachmentEventId"), false);
  assert.equal(reduceAttachmentLifecycle(state, JSON.parse(JSON.stringify(first))), state);
  const next = envelope("e2", "persisted", 2);
  const updated = reduceAttachmentLifecycle(state, next);
  assert.equal(updated.status, "persisted");
  assert.equal(reduceAttachmentLifecycle(updated, first), updated);
  assert.equal(reduceAttachmentLifecycle(updated, next), updated);
  assert.throws(
    () => reduceAttachmentLifecycle(updated, envelope("e3")),
    /invalid_attachment_lifecycle_transition/,
  );
});

test("same event id with altered authority facts rejects without changing input or state", () => {
  const first = envelope();
  const state = reduceAttachmentLifecycle(undefined, first);
  const before = JSON.stringify(state);
  const conflict = { ...first, ordering: { ...first.ordering, sequence: 2 } };
  assert.throws(
    () => reduceAttachmentLifecycle(state, conflict),
    /attachment_lifecycle_event_conflict/,
  );
  assert.equal(JSON.stringify(state), before);
  assert.equal(conflict.ordering.sequence, 2);
  assert.throws(
    () => reduceAttachmentLifecycle({ ...state, events: null }, first),
    /invalid_attachment_lifecycle_state/,
  );
});

test("payload-only, missing or conflicting envelope fields and retired versions are rejected", () => {
  const first = envelope();
  for (const invalid of [
    first.payload,
    { ...first, identity: { ...first.identity, eventId: "" } },
    { ...first, identity: { ...first.identity, turnScopeId: "other" } },
    { ...first, protocol: { ...first.protocol, schemaVersion: 1 } },
    legacyCommit().envelope,
    { ...first, payload: { ...first.payload, attachmentEventId: "second-id" } },
  ]) {
    assert.equal(validateProtocolEvent(invalid).valid, false);
    assert.throws(
      () => requireAttachmentLifecycleEnvelope(invalid),
      /invalid_attachment_lifecycle_envelope/,
    );
  }
});

test("explicit v1 migration preserves envelope ID, ordering, causality and all journal delivery facts", () => {
  const commit = legacyCommit();
  const records = [
    commit,
    { op: "attempt", eventId: "e1", consumerId: "c1", attemptedAt: commit.committedAt },
    {
      op: "ack",
      eventId: "e1",
      consumerId: "c1",
      deliveredAt: commit.committedAt,
      orderingDomain: commit.envelope.ordering.domain,
      orderingScopeId: commit.envelope.ordering.scopeId,
      sequence: 1,
    },
    { op: "remove", eventId: "gone" },
  ];
  const before = JSON.stringify(records);
  const migrated = migrateAttachmentLifecycleOutboxRecords(records);
  assert.equal(migrated.changed, true);
  assert.equal(JSON.stringify(records), before);
  assert.deepEqual(migrated.records.slice(1), records.slice(1));
  const current = migrated.records[0].envelope;
  assert.equal(current.identity.eventId, "e1");
  assert.deepEqual(current.identity, commit.envelope.identity);
  assert.deepEqual(current.ordering, commit.envelope.ordering);
  assert.deepEqual(current.causality, commit.envelope.causality);
  assert.equal(current.payload.eventVersion, 2);
  assert.equal(Object.hasOwn(current.payload, "attachmentEventId"), false);
  const stored = projectAuthorityOutboxJournal(migrated.records);
  assert.equal(stored[0].deliveries.c1.attempts, 1);
  assert.equal(stored[0].deliveries.c1.deliveredAt, commit.committedAt);
  const state = reduceAttachmentLifecycle(undefined, current);
  assert.equal(reduceAttachmentLifecycle(state, stored[0].envelope), state);
  assert.equal(migrateAttachmentLifecycleOutboxRecords(migrated.records).changed, false);
});

test("migration rejects ambiguous legacy IDs and malformed records without mutating the batch", () => {
  const first = legacyCommit();
  const invalidInputs = [
    [first, legacyCommit("e2", "old-1")],
    [{ ...first, eventId: "foreign" }],
    [
      {
        ...first,
        envelope: {
          ...first.envelope,
          payload: { ...first.envelope.payload, attachmentEventId: " " },
        },
      },
    ],
    [
      {
        ...first,
        envelope: { ...first.envelope, payload: { ...first.envelope.payload, unexpected: true } },
      },
    ],
    [
      first,
      { ...legacyCommit("e1", "old-2"), envelope: { ...first.envelope, occurredAt: "different" } },
    ],
  ];
  for (const records of invalidInputs) {
    const before = JSON.stringify(records);
    assert.throws(() => migrateAttachmentLifecycleOutboxRecords(records));
    assert.equal(JSON.stringify(records), before);
  }
});
