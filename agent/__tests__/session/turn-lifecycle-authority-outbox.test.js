/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { TURN_EVENT, TURN_PHASE } from "@noobot/session-protocol";
import {
  deliveryReceiptOf,
  event,
  eventIdOf,
  harness,
  now,
} from "./turn-lifecycle-session-contract.test-helpers.js";

test("authority outbox delivery is read, attempted, and acknowledged through the session transaction", async () => {
  const h = harness();
  const accepted = await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.ACTION_ACCEPTED, "outbox-r1", 0, {
      action: "send",
      phase: TURN_PHASE.ACTION,
    }),
  );
  const receipt = deliveryReceiptOf(accepted.envelope);
  const { eventId } = receipt;

  const pending = await h.service.getPendingAuthorityEvents({ userId: "u1", sessionId: "s1" });
  assert.equal(pending.found, true);
  assert.deepEqual(
    pending.events.map((item) => item.eventId),
    [eventId],
  );
  assert.equal(pending.events[0].delivery.attempts, 0);

  const attempted = await h.service.recordAuthorityEventAttempts({
    userId: "u1",
    sessionId: "s1",
    eventIds: [eventId],
  });
  assert.equal(attempted.recorded, true);
  assert.equal((await h.outboxEntry(eventId)).delivery.attempts, 1);
  assert.equal((await h.outboxEntry(eventId)).delivery.lastAttemptAt, now());

  const acknowledged = await h.service.acknowledgeAuthorityEvents({
    userId: "u1",
    sessionId: "s1",
    consumerId: receipt.consumerId,
    acknowledgements: [receipt],
  });
  assert.equal(acknowledged.acknowledged, true);
  assert.equal(acknowledged.delivered, 1);
  assert.equal(acknowledged.deduplicated, 0);
  assert.equal(
    (await h.service.getPendingAuthorityEvents({ userId: "u1", sessionId: "s1" })).events.length,
    0,
  );
  assert.equal((await h.outboxEntry(eventId)).delivery.deliveredAt, now());

  const replay = await h.service.acknowledgeAuthorityEvents({
    userId: "u1",
    sessionId: "s1",
    consumerId: receipt.consumerId,
    acknowledgements: [receipt],
  });
  assert.equal(replay.acknowledged, true);
  assert.equal(replay.delivered, 1);
  assert.equal(replay.deduplicated, 1);
});

test("authority outbox delivery mutations remain atomic when session persistence fails", async () => {
  const h = harness();
  const accepted = await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.ACTION_ACCEPTED, "outbox-failure-r1", 0, {
      action: "send",
      phase: TURN_PHASE.ACTION,
    }),
  );
  const receipt = deliveryReceiptOf(accepted.envelope);
  const { eventId } = receipt;

  let restore = h.failOutboxJournal();
  await assert.rejects(() =>
    h.service.recordAuthorityEventAttempts({ userId: "u1", sessionId: "s1", eventIds: [eventId] }),
  );
  restore();
  assert.equal((await h.outboxEntry(eventId)).delivery.attempts, 0);

  restore = h.failOutboxJournal();
  await assert.rejects(() =>
    h.service.acknowledgeAuthorityEvents({
      userId: "u1",
      sessionId: "s1",
      consumerId: receipt.consumerId,
      acknowledgements: [receipt],
    }),
  );
  restore();
  assert.equal((await h.outboxEntry(eventId)).delivery.deliveredAt, "");
});

test("authority outbox compaction is explicit, receipt-safe, and atomic on persistence failure", async () => {
  const h = harness();
  const accepted = await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.ACTION_ACCEPTED, "compact-r1", 0, {
      action: "send",
      phase: TURN_PHASE.ACTION,
    }),
  );
  const receipt = deliveryReceiptOf(accepted.envelope);
  const { eventId } = receipt;
  await h.service.acknowledgeAuthorityEvents({
    userId: "u1",
    sessionId: "s1",
    consumerId: receipt.consumerId,
    acknowledgements: [receipt],
  });

  const invalid = await h.service.compactAuthorityEvents({
    userId: "u1",
    sessionId: "s1",
    deliveredThroughSequence: 1,
    consumerId: receipt.consumerId,
    orderingDomain: receipt.orderingDomain,
    orderingScopeId: receipt.orderingScopeId,
  });
  assert.equal(invalid.reason, "invalid_retention_cutoff");
  assert.equal((await h.outbox()).length, 1);

  const restore = h.failOutboxJournal();
  await assert.rejects(() =>
    h.service.compactAuthorityEvents({
      userId: "u1",
      sessionId: "s1",
      deliveredThroughSequence: 1,
      consumerId: receipt.consumerId,
      orderingDomain: receipt.orderingDomain,
      orderingScopeId: receipt.orderingScopeId,
      retainDeliveredAfter: "2026-07-19T00:00:00.000Z",
    }),
  );
  restore();
  assert.equal((await h.outbox()).length, 1);

  const compacted = await h.service.compactAuthorityEvents({
    userId: "u1",
    sessionId: "s1",
    deliveredThroughSequence: 1,
    consumerId: receipt.consumerId,
    orderingDomain: receipt.orderingDomain,
    orderingScopeId: receipt.orderingScopeId,
    retainDeliveredAfter: "2026-07-19T00:00:00.000Z",
  });
  assert.equal(compacted.compacted, true);
  assert.equal(compacted.removed, 1);
  assert.equal((await h.outbox()).length, 0);

  const replay = await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.ACTION_ACCEPTED, "compact-r1", 0, {
      action: "send",
      phase: TURN_PHASE.ACTION,
    }),
  );
  assert.equal(replay.deduplicated, true);
  assert.equal(eventIdOf(replay.envelope), eventId);
});
