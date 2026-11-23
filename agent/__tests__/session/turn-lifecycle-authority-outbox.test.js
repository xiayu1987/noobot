/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { TURN_EVENT, TURN_PHASE } from "@noobot/session-protocol";
import { authorityEventConsumerDelivery } from "@noobot/event-protocol/outbox";
import {
  deliveryReceiptOf,
  event,
  eventIdOf,
  harness,
  now,
} from "./turn-lifecycle-session-contract.test-helpers.js";

test("delivery preparation returns persisted attempts and excludes acknowledged events", async () => {
  const h = harness();
  const accepted = await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.ACTION_ACCEPTED, "attempt-projection", 0, {
      action: "send",
      phase: TURN_PHASE.ACTION,
    }),
  );
  const receipt = deliveryReceiptOf(accepted.envelope);
  const request = {
    userId: "u1",
    sessionId: "s1",
    consumerId: receipt.consumerId,
  };
  const repo = h.service.sessionRepo;
  const withOutboxMutation = repo.withSessionOutboxMutation.bind(repo);
  let reads = 0;
  repo.withSessionOutboxMutation = (...args) => {
    reads += 1;
    return withOutboxMutation(...args);
  };
  for (let attempts = 1; attempts <= 2; attempts += 1) {
    reads = 0;
    const result = await h.service.prepareAuthorityEventDelivery(request);
    assert.equal(reads, 1);
    assert.equal(result.found, true);
    assert.deepEqual(result.events, [await h.outboxEntry(receipt.eventId)]);
    assert.equal(
      authorityEventConsumerDelivery(result.events[0], receipt.consumerId).attempts,
      attempts,
    );
  }
  await h.service.acknowledgeAuthorityEvents({
    ...request,
    acknowledgements: [receipt],
  });
  reads = 0;
  const delivered = await h.service.prepareAuthorityEventDelivery(request);
  assert.equal(reads, 1);
  assert.deepEqual(delivered.events, []);
  const stored = await h.outboxEntry(receipt.eventId);
  assert.equal(authorityEventConsumerDelivery(stored, receipt.consumerId).attempts, 2);
  assert.equal(authorityEventConsumerDelivery(stored, receipt.consumerId).deliveredAt, now());
});

test("authority outbox delivery is prepared and acknowledged through the session transaction", async () => {
  const h = harness();
  const accepted = await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.ACTION_ACCEPTED, "outbox-r1", 0, {
      action: "send",
      phase: TURN_PHASE.ACTION,
    }),
  );
  const receipt = deliveryReceiptOf(accepted.envelope);
  const { eventId } = receipt;

  const pending = await h.service.getPendingAuthorityEvents({
    userId: "u1",
    sessionId: "s1",
    consumerId: receipt.consumerId,
  });
  assert.equal(pending.found, true);
  assert.deepEqual(
    pending.events.map((item) => item.eventId),
    [eventId],
  );
  assert.equal(authorityEventConsumerDelivery(pending.events[0], receipt.consumerId).attempts, 0);

  const attempted = await h.service.prepareAuthorityEventDelivery({
    userId: "u1",
    sessionId: "s1",
    consumerId: receipt.consumerId,
  });
  assert.equal(attempted.found, true);
  assert.equal(
    authorityEventConsumerDelivery(await h.outboxEntry(eventId), receipt.consumerId).attempts,
    1,
  );
  assert.equal(
    authorityEventConsumerDelivery(await h.outboxEntry(eventId), receipt.consumerId).lastAttemptAt,
    now(),
  );

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
    (
      await h.service.getPendingAuthorityEvents({
        userId: "u1",
        sessionId: "s1",
        consumerId: receipt.consumerId,
      })
    ).events.length,
    0,
  );
  assert.equal(
    authorityEventConsumerDelivery(await h.outboxEntry(eventId), receipt.consumerId).deliveredAt,
    now(),
  );

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

test("authority outbox service rejects string acknowledgement coordinates without persisting", async () => {
  const h = harness();
  const accepted = await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.ACTION_ACCEPTED, "strict-ack-r1", 0, {
      action: "send",
      phase: TURN_PHASE.ACTION,
    }),
  );
  const receipt = deliveryReceiptOf(accepted.envelope);
  await assert.rejects(
    () =>
      h.service.acknowledgeAuthorityEvents({
        userId: "u1",
        sessionId: "s1",
        consumerId: receipt.consumerId,
        acknowledgements: [{ ...receipt, sequence: String(receipt.sequence) }],
      }),
    /sequence must be a positive integer/,
  );
  assert.equal(
    authorityEventConsumerDelivery(await h.outboxEntry(receipt.eventId), receipt.consumerId)
      .deliveredAt,
    "",
  );
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

  let restore = h.failOutboxCommit();
  await assert.rejects(() =>
    h.service.prepareAuthorityEventDelivery({
      userId: "u1",
      sessionId: "s1",
      consumerId: receipt.consumerId,
    }),
  );
  restore();
  assert.equal(
    authorityEventConsumerDelivery(await h.outboxEntry(eventId), receipt.consumerId).attempts,
    0,
  );

  restore = h.failOutboxCommit();
  await assert.rejects(() =>
    h.service.acknowledgeAuthorityEvents({
      userId: "u1",
      sessionId: "s1",
      consumerId: receipt.consumerId,
      acknowledgements: [receipt],
    }),
  );
  restore();
  assert.equal(
    authorityEventConsumerDelivery(await h.outboxEntry(eventId), receipt.consumerId).deliveredAt,
    "",
  );
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

  await assert.rejects(
    () =>
      h.service.compactAuthorityEvents({
        userId: "u1",
        sessionId: "s1",
        consumerId: receipt.consumerId,
      }),
    /retainDeliveredAfter/,
  );
  assert.equal((await h.outbox()).length, 1);

  const restore = h.failOutboxCommit();
  await assert.rejects(() =>
    h.service.compactAuthorityEvents({
      userId: "u1",
      sessionId: "s1",
      consumerId: receipt.consumerId,
      retainDeliveredAfter: "2026-07-19T00:00:00.000Z",
    }),
  );
  restore();
  assert.equal((await h.outbox()).length, 1);

  const compacted = await h.service.compactAuthorityEvents({
    userId: "u1",
    sessionId: "s1",
    consumerId: receipt.consumerId,
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
