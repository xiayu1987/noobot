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
  createAuthorityOutboxProjection,
  planAuthorityOutboxJournalRecords,
} from "../src/authority-event-outbox.js";

const now = "2026-11-12T00:00:00.000Z";
function recordsFor(eventId) {
  const envelope = createEventEnvelope({
    family: "turn.lifecycle",
    schemaVersion: 1,
    identity: { eventId, eventType: "turn.completed", sessionId: "s1", turnScopeId: "t1" },
    causality: {},
    ordering: { domain: "session", scopeId: "s1", sequence: 1 },
    producer: { type: "agent", id: "a1" },
    occurredAt: now,
    payload: {},
  });
  return [
    { op: "prepare", eventId, envelope, committedAt: now },
    { op: "commit", eventId },
  ];
}

const attempt = { op: "attempt", eventId: "a", consumerId: "browser", attemptedAt: now };

test("journal batches are atomic across delivery, prepare, commit and removal", () => {
  const projection = applyAuthorityOutboxJournalRecords(
    createAuthorityOutboxProjection(),
    recordsFor("a"),
  );
  const before = structuredClone(projection);
  assert.throws(
    () =>
      applyAuthorityOutboxJournalRecords(projection, [
        attempt,
        ...recordsFor("b"),
        { op: "remove", eventId: "a" },
        { op: "commit", eventId: "missing" },
      ]),
    /commit has no prepared event/,
  );
  assert.deepEqual(projection, before);
  const planned = planAuthorityOutboxJournalRecords(projection, [attempt, attempt]);
  assert.equal(planned.entries.get("a").deliveries.browser.attempts, 2);
  assert.deepEqual(projection, before);
});

test("batch order preserves commit ordering, terminal removals and acknowledgement deduplication", () => {
  const projection = applyAuthorityOutboxJournalRecords(
    createAuthorityOutboxProjection(),
    recordsFor("a"),
  );
  const original = projection.entries.get("a");
  const b = recordsFor("b");
  const c = recordsFor("c");
  const ack = {
    op: "ack",
    eventId: "a",
    consumerId: "browser",
    deliveredAt: now,
    orderingDomain: "session",
    orderingScopeId: "s1",
    sequence: 1,
  };
  applyAuthorityOutboxJournalRecords(projection, [b[0], ...c, b[1], attempt, ack, ack]);
  assert.deepEqual([...projection.entries.keys()], ["a", "c", "b"]);
  assert.equal(projection.entries.get("a").deliveries.browser.attempts, 1);
  assert.equal(projection.entries.get("a").deliveries.browser.deliveredAt, now);
  assert.deepEqual(original.deliveries, {});
  applyAuthorityOutboxJournalRecords(projection, [
    { op: "remove", eventId: "a" },
    { op: "commit", eventId: "a" },
    { op: "remove", eventId: "d" },
    ...recordsFor("d"),
  ]);
  assert.deepEqual([...projection.entries.keys()], ["c", "b"]);
  assert.equal(projection.prepared.has("d"), true);
  assert.deepEqual([...projection.removedEventIds], ["a", "d"]);
});

test("journal planning only reads the IDs touched by the batch", () => {
  const projection = applyAuthorityOutboxJournalRecords(
    createAuthorityOutboxProjection(),
    recordsFor("a"),
  );
  const lookups = [];
  const input = {
    entries: {
      get(id) {
        lookups.push(id);
        return projection.entries.get(id);
      },
    },
    prepared: { get: (id) => projection.prepared.get(id) },
    removedEventIds: { has: (id) => projection.removedEventIds.has(id) },
  };
  assert.equal(planAuthorityOutboxJournalRecords(input, [attempt, attempt]).entries.size, 1);
  assert.deepEqual(lookups, ["a"]);
});
