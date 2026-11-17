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
  planAuthorityOutboxAcknowledgements,
} from "../src/authority-event-outbox.js";

const now = "2026-11-12T00:00:00.000Z";
function fixture() {
  const eventId = "event-ack";
  const projection = createAuthorityOutboxProjection();
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
  applyAuthorityOutboxJournalRecords(projection, [
    { op: "prepare", eventId, envelope, committedAt: now },
    { op: "commit", eventId },
  ]);
  const ack = {
    op: "ack",
    eventId,
    consumerId: "websocket",
    deliveredAt: now,
    orderingDomain: "session",
    orderingScopeId: "s1",
    sequence: 1,
  };
  return { projection, ack };
}

test("acknowledgement plans deduplicate within a batch and leave the source unchanged", () => {
  const { projection, ack } = fixture();
  const original = projection.entries.get(ack.eventId);
  const result = planAuthorityOutboxAcknowledgements(projection, [ack, ack]);
  assert.deepEqual(result, { acknowledged: true, delivered: 2, deduplicated: 1, records: [ack] });
  assert.equal(projection.entries.get(ack.eventId), original);
  assert.deepEqual(original.deliveries, {});
  applyAuthorityOutboxJournalRecords(projection, result.records);
  assert.deepEqual(planAuthorityOutboxAcknowledgements(projection, [ack]), {
    acknowledged: true,
    delivered: 1,
    deduplicated: 1,
    records: [],
  });
  const other = { ...ack, consumerId: "cli" };
  assert.deepEqual(planAuthorityOutboxAcknowledgements(projection, [other]).records, [other]);
});

test("missing or mismatched acknowledgements never partially mutate the source", () => {
  const { projection, ack } = fixture();
  const original = projection.entries.get(ack.eventId);
  assert.deepEqual(
    planAuthorityOutboxAcknowledgements(projection, [ack, { ...ack, eventId: "missing" }]),
    {
      acknowledged: false,
      reason: "event_not_found",
      delivered: 1,
      deduplicated: 0,
    },
  );
  assert.throws(
    () => planAuthorityOutboxAcknowledgements(projection, [ack, { ...ack, sequence: 2 }]),
    /ordering mismatch/,
  );
  assert.throws(
    () => planAuthorityOutboxAcknowledgements(projection, [{ ...ack, op: "remove" }]),
    /expected acknowledgement/,
  );
  assert.equal(projection.entries.get(ack.eventId), original);
  assert.deepEqual(original.deliveries, {});
});

test("acknowledgement planning only looks up requested events without scanning history", () => {
  const { projection, ack } = fixture();
  const entries = projection.entries;
  const lookups = [];
  const input = {
    get entries() {
      return {
        get(id) {
          lookups.push(id);
          return entries.get(id);
        },
      };
    },
    get prepared() {
      throw new Error("must not copy prepared history");
    },
    get removedEventIds() {
      throw new Error("must not copy removed history");
    },
  };
  assert.equal(planAuthorityOutboxAcknowledgements(input, [ack, ack]).acknowledged, true);
  assert.deepEqual(lookups, [ack.eventId]);
});
