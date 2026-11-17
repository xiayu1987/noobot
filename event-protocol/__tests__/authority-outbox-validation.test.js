/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createEventEnvelope } from "../src/envelope.js";
import {
  acknowledgeAuthorityEventDelivery,
  assertAuthorityOutboxRequest,
  assertAuthorityOutboxJournalRecord,
  authorityEventConsumerDelivery,
  listPendingAuthorityEvents,
  migrateLegacyUnownedAttemptRecords,
  normalizeAuthorityEventOutbox,
  projectAuthorityOutboxJournal,
  projectAuthorityEventDeliveryResults,
} from "../src/authority-event-outbox.js";

const occurredAt = "2026-10-31T00:00:00.000Z";
function entry() {
  return {
    eventId: "event-1",
    committedAt: occurredAt,
    deliveries: {},
    envelope: createEventEnvelope({
      family: "turn.lifecycle",
      schemaVersion: 1,
      identity: {
        eventId: "event-1",
        eventType: "turn.completed",
        sessionId: "s1",
        turnScopeId: "t1",
      },
      causality: {},
      ordering: { domain: "session", scopeId: "s1", sequence: 1 },
      producer: { type: "agent", id: "agent-1" },
      occurredAt,
      payload: {},
    }),
  };
}
test("delivery responses use committed facts without recomputing attempts or changing other consumers", () => {
  const source = entry();
  source.deliveries.other = authorityEventConsumerDelivery(source, "other");
  const before = structuredClone(source);
  const delivery = {
    ...authorityEventConsumerDelivery(source, "browser"),
    attempts: 7,
    lastAttemptAt: occurredAt,
  };
  const projected = projectAuthorityEventDeliveryResults([source], "browser", [
    { eventId: source.eventId, delivery },
  ]);
  assert.equal(projected[0].deliveries.browser.attempts, 7);
  assert.deepEqual(projected[0].deliveries.other, source.deliveries.other);
  assert.deepEqual(source, before);
  assert.notEqual(projected[0].deliveries.browser, delivery);
});

test("delivery response projection rejects missing, foreign, reordered, duplicate or corrupt results", () => {
  const source = entry();
  const delivery = authorityEventConsumerDelivery(source, "browser");
  for (const results of [
    null,
    [],
    [null],
    [{ eventId: "foreign", delivery }],
    [{ eventId: source.eventId }],
    [{ eventId: source.eventId, delivery: { ...delivery, attempts: -1 } }],
    [
      { eventId: source.eventId, delivery },
      { eventId: source.eventId, delivery },
    ],
  ]) {
    assert.throws(() => projectAuthorityEventDeliveryResults([source], "browser", results), {
      code: "AUTHORITY_OUTBOX_INTEGRITY_INVALID",
    });
  }
  const other = structuredClone(source);
  other.eventId = other.envelope.identity.eventId = "event-2";
  assert.throws(
    () =>
      projectAuthorityEventDeliveryResults([source, other], "browser", [
        { eventId: other.eventId, delivery },
        { eventId: source.eventId, delivery },
      ]),
    { code: "AUTHORITY_OUTBOX_INTEGRITY_INVALID" },
  );
});

function prepare() {
  const { deliveries, ...value } = entry();
  assert.deepEqual(deliveries, {});
  return { op: "prepare", ...value };
}
function commit() {
  return { op: "commit", eventId: "event-1" };
}
function ack(overrides = {}) {
  return {
    op: "ack",
    eventId: "event-1",
    consumerId: "browser",
    deliveredAt: occurredAt,
    orderingDomain: "session",
    orderingScopeId: "s1",
    sequence: 1,
    ...overrides,
  };
}

test("outbox rejects invalid entries instead of dropping them or repairing identity", () => {
  for (const source of [
    null,
    {},
    [null],
    [{}],
    [entry(), entry()],
    [{ ...entry(), eventId: "other" }],
    [{ ...entry(), committedAt: "" }],
    [{ ...entry(), deliveries: null }],
  ]) {
    assert.throws(() => normalizeAuthorityEventOutbox(source), /invalid authority outbox/);
  }
});

test("outbox delivery reads reject corrupt numbers and missing delivery facts", () => {
  const initial = authorityEventConsumerDelivery(entry(), "browser");
  assert.equal(initial.status, "pending");
  for (const patch of [
    { attempts: "0" },
    { attempts: -1 },
    { attempts: 1.5 },
    { attempts: 1 },
    { sequence: "0" },
    { deliveredAt: occurredAt },
    { deliveredAt: null },
  ]) {
    const source = { ...entry(), deliveries: { browser: { ...initial, ...patch } } };
    assert.throws(() => normalizeAuthorityEventOutbox([source]), /invalid authority outbox/);
  }
  assert.throws(
    () => authorityEventConsumerDelivery({ deliveries: { browser: null } }, "browser"),
    /invalid authority outbox/,
  );
});

for (const patch of [
  { orderingDomain: "foreign" },
  { orderingScopeId: "foreign" },
  { sequence: 2 },
]) {
  test(`stored acknowledgement rejects mismatched ${Object.keys(patch)[0]} at protocol reads`, () => {
    const [source] = acknowledgeAuthorityEventDelivery([entry()], ack()).outbox;
    assert.deepEqual(normalizeAuthorityEventOutbox([source]), [source]);
    assert.deepEqual(listPendingAuthorityEvents([source], { consumerId: "browser" }), []);
    assert.equal(authorityEventConsumerDelivery(source, "other").status, "pending");
    Object.assign(source.deliveries.browser, patch);
    const before = structuredClone(source);
    const invalid = { code: "AUTHORITY_OUTBOX_INTEGRITY_INVALID" };
    assert.throws(() => normalizeAuthorityEventOutbox([source]), invalid);
    assert.throws(() => authorityEventConsumerDelivery(source, "browser"), invalid);
    assert.throws(() => listPendingAuthorityEvents([source], { consumerId: "other" }), invalid);
    assert.throws(() => acknowledgeAuthorityEventDelivery([source], ack()), invalid);
    assert.deepEqual(source, before, "invalid stored receipts must not be silently rewritten");
  });
}

test("outbox journal rejects malformed and orphan delivery records", () => {
  for (const records of [
    null,
    [null],
    [{ op: "unknown", eventId: "event-1" }],
    [ack()],
    [commit()],
    [{ ...prepare(), op: "commit" }],
    [prepare(), commit(), ack({ sequence: "1" })],
    [prepare(), commit(), ack({ orderingScopeId: "other" })],
    [prepare(), commit(), ack({ deliveredAt: "" })],
    [
      prepare(),
      commit(),
      { op: "attempt", eventId: "event-1", consumerId: "browser", attemptedAt: "" },
    ],
  ]) {
    assert.throws(() => projectAuthorityOutboxJournal(records), /invalid authority outbox/);
  }
});

test("outbox journal preserves delivery retries and rejects conflicting duplicate commits", () => {
  const firstCommit = commit();
  const attempt = {
    op: "attempt",
    eventId: "event-1",
    consumerId: "browser",
    attemptedAt: occurredAt,
  };
  const [projected] = projectAuthorityOutboxJournal([
    prepare(),
    firstCommit,
    firstCommit,
    attempt,
    attempt,
    ack(),
    ack(),
    attempt,
  ]);
  const delivery = authorityEventConsumerDelivery(projected, "browser");
  assert.equal(delivery.attempts, 2);
  assert.equal(delivery.status, "delivered");
  assert.equal(delivery.sequence, 1);
  assert.throws(
    () =>
      projectAuthorityOutboxJournal([
        prepare(),
        firstCommit,
        { ...prepare(), committedAt: "2026-10-31T00:00:01.000Z" },
      ]),
    /conflicting commit/,
  );
  assert.deepEqual(
    projectAuthorityOutboxJournal([
      prepare(),
      firstCommit,
      { op: "remove", eventId: "event-1" },
      firstCommit,
    ]),
    [],
  );
});

test("outbox acknowledgement rejects string sequence without coercion", () => {
  assert.throws(
    () => acknowledgeAuthorityEventDelivery([entry()], ack({ sequence: "1" })),
    /sequence must be a positive integer/,
  );
  const accepted = acknowledgeAuthorityEventDelivery([entry()], ack());
  assert.equal(accepted.changed, true);
  assert.equal(authorityEventConsumerDelivery(accepted.outbox[0], "browser").status, "delivered");
});

test("outbox request protocol rejects malformed identities and whole invalid delivery batches", () => {
  const owner = { userId: "u1", sessionId: "s1", consumerId: "browser" };
  for (const [operation, patch] of [
    ["pending", { userId: " u1" }],
    ["pending", { sessionId: "" }],
    ["pending", { consumerId: "browser " }],
    ["attempt", { eventIds: [] }],
    ["attempt", { eventIds: ["event-1", ""] }],
    ["attempt", { eventIds: ["event-1", "event-1"] }],
    ["ack", { acknowledgements: [ack(), null] }],
    ["ack", { acknowledgements: [ack(), ack()] }],
    ["ack", { acknowledgements: [ack({ sequence: "1" })] }],
    ["compact", { retainDeliveredAfter: "invalid" }],
  ]) {
    assert.throws(
      () => assertAuthorityOutboxRequest({ ...owner, ...patch }, operation),
      /invalid authority outbox/,
    );
  }
  assert.deepEqual(assertAuthorityOutboxRequest(owner, "pending"), owner);
});

test("outbox acknowledgement rejects mismatched ordering and keeps the event pending", () => {
  const source = [entry()];
  assert.throws(
    () => acknowledgeAuthorityEventDelivery(source, ack({ orderingScopeId: "other" })),
    /acknowledgement ordering mismatch/,
  );
  assert.equal(authorityEventConsumerDelivery(source[0], "browser").status, "pending");
});

test("legacy unowned attempt covered by a later ack is dropped and projection stays delivered", () => {
  const legacyAttempt = { op: "attempt", eventId: "event-1", attemptedAt: occurredAt };
  const { records, changed } = migrateLegacyUnownedAttemptRecords([
    prepare(),
    commit(),
    legacyAttempt,
    ack(),
  ]);
  assert.equal(changed, true);
  assert.deepEqual(records, [prepare(), commit(), ack()]);
  const [projected] = projectAuthorityOutboxJournal(records);
  assert.equal(authorityEventConsumerDelivery(projected, "browser").status, "delivered");
});

test("legacy unowned attempt without a later ack is kept and still rejected", () => {
  const legacyAttempt = { op: "attempt", eventId: "event-1", attemptedAt: occurredAt };
  for (const source of [
    [commit(), legacyAttempt],
    [commit(), ack(), legacyAttempt],
    [commit(), legacyAttempt, ack({ eventId: "event-2" })],
  ]) {
    const { records, changed } = migrateLegacyUnownedAttemptRecords(source);
    assert.equal(changed, false);
    assert.deepEqual(records, source);
  }
  assert.throws(
    () => assertAuthorityOutboxJournalRecord(legacyAttempt),
    /consumerId must be canonical text/,
  );
});

test("owned attempts are untouched by the legacy attempt migration", () => {
  const owned = {
    op: "attempt",
    eventId: "event-1",
    consumerId: "browser",
    attemptedAt: occurredAt,
  };
  const blank = { ...owned, consumerId: "" };
  for (const source of [
    [commit(), owned, ack()],
    [commit(), blank, ack()],
  ]) {
    assert.deepEqual(migrateLegacyUnownedAttemptRecords(source), {
      records: source,
      changed: false,
    });
  }
  assert.throws(() => migrateLegacyUnownedAttemptRecords(null), /journal records must be an array/);
});
