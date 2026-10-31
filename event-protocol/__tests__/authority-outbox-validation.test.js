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
  authorityEventConsumerDelivery,
  normalizeAuthorityEventOutbox,
  projectAuthorityOutboxJournal,
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
function commit() {
  const { deliveries, ...value } = entry();
  assert.deepEqual(deliveries, {});
  return { op: "commit", ...value };
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

test("outbox journal rejects malformed and orphan delivery records", () => {
  for (const records of [
    null,
    [null],
    [{ op: "unknown", eventId: "event-1" }],
    [ack()],
    [commit(), ack({ sequence: "1" })],
    [commit(), ack({ orderingScopeId: "other" })],
    [commit(), ack({ deliveredAt: "" })],
    [commit(), { op: "attempt", eventId: "event-1", consumerId: "browser", attemptedAt: "" }],
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
        firstCommit,
        { ...firstCommit, committedAt: "2026-10-31T00:00:01.000Z" },
      ]),
    /conflicting commit/,
  );
  assert.deepEqual(
    projectAuthorityOutboxJournal([firstCommit, { op: "remove", eventId: "event-1" }]),
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
