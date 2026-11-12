/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createEventEnvelope } from "../src/envelope.js";
import {
  migrateAuthorityOutboxJournalRecords,
  projectAuthorityOutboxJournal,
} from "../src/authority-event-outbox.js";

const committedAt = "2026-11-11T00:00:00.000Z";
const envelope = createEventEnvelope({
  family: "turn.lifecycle",
  schemaVersion: 1,
  identity: { eventId: "e1", eventType: "turn.completed", sessionId: "s1", turnScopeId: "t1" },
  causality: {},
  ordering: { domain: "session", scopeId: "s1", sequence: 1 },
  producer: { type: "agent", id: "agent-1" },
  occurredAt: committedAt,
  payload: {},
});
const legacyCommit = () => ({ op: "commit", eventId: "e1", envelope, committedAt });

test("explicit outbox migration preserves delivery facts, deletion and idempotence", () => {
  const source = [
    legacyCommit(),
    { op: "attempt", eventId: "e1", consumerId: "browser", attemptedAt: committedAt },
    {
      op: "ack",
      eventId: "e1",
      consumerId: "browser",
      deliveredAt: committedAt,
      orderingDomain: "session",
      orderingScopeId: "s1",
      sequence: 1,
    },
  ];
  const before = structuredClone(source);
  const migrated = migrateAuthorityOutboxJournalRecords(source);
  assert.equal(migrated.changed, true);
  assert.deepEqual(source, before);
  assert.deepEqual(migrated.records[0], { ...legacyCommit(), op: "prepare" });
  assert.deepEqual(migrated.records[1], { op: "commit", eventId: "e1" });
  const [entry] = projectAuthorityOutboxJournal(migrated.records);
  assert.deepEqual(entry.envelope, envelope);
  assert.equal(entry.deliveries.browser.attempts, 1);
  assert.equal(entry.deliveries.browser.deliveredAt, committedAt);
  assert.deepEqual(migrateAuthorityOutboxJournalRecords(migrated.records), {
    records: migrated.records,
    changed: false,
  });
  assert.deepEqual(
    projectAuthorityOutboxJournal([
      ...migrated.records,
      { op: "remove", eventId: "e1" },
      { op: "commit", eventId: "e1" },
    ]),
    [],
  );
});

test("prepared events are invisible until commit and missing or conflicting facts fail explicitly", () => {
  const prepare = { ...legacyCommit(), op: "prepare" };
  assert.deepEqual(projectAuthorityOutboxJournal([prepare]), []);
  assert.throws(
    () => projectAuthorityOutboxJournal([legacyCommit()]),
    /without copying its envelope/,
  );
  assert.throws(
    () => migrateAuthorityOutboxJournalRecords([{ op: "commit", eventId: "e1" }]),
    /no prepared event/,
  );
  assert.throws(
    () =>
      migrateAuthorityOutboxJournalRecords([
        legacyCommit(),
        { ...legacyCommit(), committedAt: "2026-11-12T00:00:00.000Z" },
      ]),
    /conflicting commit/,
  );
});
