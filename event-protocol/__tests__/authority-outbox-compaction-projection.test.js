/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createEventEnvelope } from "../src/envelope.js";
import {
  applyAuthorityOutboxJournalRecords,
  compactAuthorityEventOutbox,
  createAuthorityOutboxProjection,
  listAuthorityOutboxProjection,
} from "../src/authority-event-outbox.js";

const occurredAt = "2026-11-12T00:00:00.000Z";
const cutoff = "2026-11-12T00:05:00.000Z";
function prepare(eventId, sequence) {
  return {
    op: "prepare",
    eventId,
    committedAt: occurredAt,
    envelope: createEventEnvelope({
      family: "turn.lifecycle",
      schemaVersion: 1,
      identity: { eventId, eventType: "turn.completed", sessionId: "s1", turnScopeId: "t1" },
      causality: {},
      ordering: { domain: "session", scopeId: "s1", sequence },
      producer: { type: "agent", id: "agent-1" },
      occurredAt,
      payload: {},
    }),
  };
}
function ack(eventId, sequence, consumerId, deliveredAt) {
  return {
    op: "ack",
    eventId,
    sequence,
    consumerId,
    deliveredAt,
    orderingDomain: "session",
    orderingScopeId: "s1",
  };
}

test("projection compaction preserves delivery retention, order and source immutability", () => {
  const projection = createAuthorityOutboxProjection();
  const ids = ["old", "pending", "attempted", "mixed", "boundary", "future"];
  for (const [sequence, eventId] of ids.entries()) {
    applyAuthorityOutboxJournalRecords(projection, [
      prepare(eventId, sequence + 1),
      { op: "commit", eventId },
    ]);
  }
  applyAuthorityOutboxJournalRecords(projection, [
    ack("old", 1, "a", occurredAt),
    { op: "attempt", eventId: "attempted", consumerId: "a", attemptedAt: occurredAt },
    ack("mixed", 4, "a", occurredAt),
    { op: "attempt", eventId: "mixed", consumerId: "b", attemptedAt: occurredAt },
    ack("boundary", 5, "a", cutoff),
    ack("future", 6, "a", "2026-11-12T00:06:00.000Z"),
  ]);
  const original = listAuthorityOutboxProjection(projection);
  const result = compactAuthorityEventOutbox(projection.entries.values(), {
    retainDeliveredAfter: cutoff,
  });
  assert.deepEqual(result, {
    compacted: true,
    removed: 1,
    nextRetainedDeliveryAt: cutoff,
    outbox: original.slice(1),
  });
  assert.deepEqual(
    result.outbox.map((item) => item.eventId),
    ids.slice(1),
  );
  assert.equal(result.removed, 1);
  assert.equal(result.compacted, true);
  assert.deepEqual(listAuthorityOutboxProjection(projection), original);
  for (const item of result.outbox) assert.equal(item, projection.entries.get(item.eventId));
  assert.throws(
    () =>
      compactAuthorityEventOutbox(projection.entries.values(), { retainDeliveredAfter: "invalid" }),
    /invalid authority outbox/,
  );
});

test("projection rejects corrupt input at journal ingestion before compaction", () => {
  const projection = createAuthorityOutboxProjection();
  const invalid = prepare("bad", 1);
  invalid.envelope = {
    ...invalid.envelope,
    identity: { ...invalid.envelope.identity, eventId: "mismatch" },
  };
  assert.throws(
    () => applyAuthorityOutboxJournalRecords(projection, [invalid]),
    /invalid authority outbox/,
  );
  assert.equal(projection.entries.size, 0);
  const result = compactAuthorityEventOutbox(projection.entries.values(), {
    retainDeliveredAfter: cutoff,
  });
  assert.deepEqual(result, {
    compacted: false,
    removed: 0,
    nextRetainedDeliveryAt: null,
    outbox: [],
  });
});

test("retention deadline uses the latest consumer delivery and excludes pending consumers", () => {
  const projection = createAuthorityOutboxProjection();
  applyAuthorityOutboxJournalRecords(projection, [
    prepare("multi", 1),
    { op: "commit", eventId: "multi" },
    ack("multi", 1, "a", cutoff),
    ack("multi", 1, "b", "2026-11-12T00:06:00.000Z"),
    prepare("pending", 2),
    { op: "commit", eventId: "pending" },
    ack("pending", 2, "a", cutoff),
    { op: "attempt", eventId: "pending", consumerId: "b", attemptedAt: cutoff },
  ]);
  const result = compactAuthorityEventOutbox(projection.entries.values(), {
    retainDeliveredAfter: cutoff,
  });
  assert.equal(result.nextRetainedDeliveryAt, "2026-11-12T00:06:00.000Z");
  const expired = compactAuthorityEventOutbox(result.outbox, {
    retainDeliveredAfter: "2026-11-12T00:06:00.001Z",
  });
  assert.equal(expired.removed, 1);
  assert.equal(expired.nextRetainedDeliveryAt, null);
  assert.deepEqual(
    expired.outbox.map((item) => item.eventId),
    ["pending"],
  );
});
