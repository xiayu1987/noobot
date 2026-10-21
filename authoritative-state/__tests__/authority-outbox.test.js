/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { TURN_EVENT, TURN_PHASE, TURN_STATE } from "@noobot/session-protocol/turn-lifecycle";
import {
  AUTHORITY_OUTBOX_JOURNAL_OP,
  acknowledgeAuthorityEventDelivery,
  compactAuthorityEventOutbox,
  listPendingAuthorityEvents,
  migrateLegacyAuthorityEventOutbox,
  normalizeAuthorityEventOutbox,
  projectAuthorityOutboxJournal,
  recordAuthorityEventDeliveryAttempt,
} from "@noobot/event-protocol/outbox";
import { createCommittedTurnLifecycleEnvelope } from "../src/application/commit-turn-lifecycle.js";

test("authority outbox tracks attempts and acknowledges delivery idempotently", () => {
  const envelope = createCommittedTurnLifecycleEnvelope({
    event: {
      eventType: TURN_EVENT.PROCESSING_STARTED,
      eventId: "outbox-event-1",
      commandId: "outbox-command-1",
      causationId: "outbox-command-1",
      sessionId: "outbox-session-1",
      turnScopeId: "outbox-turn-1",
    },
    turn: {
      turnScopeId: "outbox-turn-1",
      commandId: "outbox-command-1",
      presentationMessageId: "outbox-presentation-1",
      revision: 1,
      sequence: 1,
      phase: TURN_PHASE.PROCESSING,
      state: TURN_STATE.PROCESSING,
      updatedAt: "2026-07-18T00:00:00.000Z",
    },
  });
  const initial = normalizeAuthorityEventOutbox([
    { eventId: envelope.identity.eventId, envelope, committedAt: envelope.occurredAt },
  ]);
  const consumerId = "service-websocket";
  assert.throws(
    () => listPendingAuthorityEvents(initial, { consumerId: "" }),
    /require a delivery consumer/,
  );
  assert.equal(listPendingAuthorityEvents(initial, { consumerId }).length, 1);
  assert.equal(
    recordAuthorityEventDeliveryAttempt(initial, { eventId: envelope.identity.eventId }).reason,
    "missing_delivery_consumer",
  );
  const attempted = recordAuthorityEventDeliveryAttempt(initial, {
    eventId: envelope.identity.eventId,
    consumerId,
    attemptedAt: "2026-07-18T00:00:01.000Z",
  });
  assert.equal(attempted.found, true);
  assert.equal(attempted.outbox[0].deliveries[consumerId].attempts, 1);
  const acknowledged = acknowledgeAuthorityEventDelivery(attempted.outbox, {
    eventId: envelope.identity.eventId,
    consumerId,
    orderingDomain: envelope.ordering.domain,
    orderingScopeId: envelope.ordering.scopeId,
    sequence: envelope.ordering.sequence,
    deliveredAt: "2026-07-18T00:00:02.000Z",
  });
  assert.equal(acknowledged.changed, true);
  assert.equal(listPendingAuthorityEvents(acknowledged.outbox, { consumerId }).length, 0);
  const replay = acknowledgeAuthorityEventDelivery(acknowledged.outbox, {
    eventId: envelope.identity.eventId,
    consumerId,
    orderingDomain: envelope.ordering.domain,
    orderingScopeId: envelope.ordering.scopeId,
    sequence: envelope.ordering.sequence,
    deliveredAt: "2026-07-18T00:00:03.000Z",
  });
  assert.equal(replay.found, true);
  assert.equal(replay.changed, false);
  assert.equal(replay.outbox[0].deliveries[consumerId].deliveredAt, "2026-07-18T00:00:02.000Z");
});

test("outbox compaction reclaims only events every attempting consumer delivered before the cutoff", () => {
  const envelope = (eventId, sequence) =>
    createCommittedTurnLifecycleEnvelope({
      event: {
        eventType: TURN_EVENT.PROCESSING_STARTED,
        eventId,
        commandId: `command-${eventId}`,
        causationId: `command-${eventId}`,
        sessionId: "session-1",
        turnScopeId: "turn-1",
      },
      turn: {
        turnScopeId: "turn-1",
        commandId: `command-${eventId}`,
        presentationMessageId: "presentation-1",
        revision: sequence,
        sequence,
        phase: TURN_PHASE.PROCESSING,
        state: TURN_STATE.PROCESSING,
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
    });
  const delivered = (eventId, sequence, deliveries, scopeId = "message-1") => {
    const item = envelope(eventId, sequence);
    return {
      eventId,
      envelope: item,
      committedAt: "2026-07-01T00:00:00.000Z",
      deliveries: Object.fromEntries(
        Object.entries(deliveries).map(([consumerId, deliveredAt]) => [
          consumerId,
          {
            attempts: 1,
            lastAttemptAt: "2026-07-01T00:00:00.000Z",
            orderingDomain: item.ordering.domain,
            orderingScopeId: scopeId,
            sequence,
            deliveredAt,
          },
        ]),
      ),
    };
  };
  const old = "2026-07-02T00:00:00.000Z";
  const source = [
    {
      eventId: "pending",
      envelope: envelope("pending", 1),
      committedAt: "2026-07-01T00:00:00.000Z",
    },
    delivered("recent", 2, { "service-websocket": "2026-07-20T00:00:00.000Z" }),
    delivered("attempted-not-delivered", 3, { "service-websocket": old, "service-cli": "" }),
    delivered("old-stream-a", 4, { "service-websocket": old }, "message-a"),
    delivered("old-both", 5, { "service-websocket": old, "service-cli": old }, "message-b"),
  ];
  const result = compactAuthorityEventOutbox(source, {
    retainDeliveredAfter: "2026-07-10T00:00:00.000Z",
  });
  assert.equal(result.removed, 2);
  assert.deepEqual(
    result.outbox.map((item) => item.eventId),
    ["pending", "recent", "attempted-not-delivered"],
  );
  assert.equal(
    compactAuthorityEventOutbox(source, { retainDeliveredAfter: "not-a-date" }).reason,
    "invalid_retention_cutoff",
  );
});

test("authority outbox tracks each consumer independently so one ack never hides events from another", () => {
  const envelope = createCommittedTurnLifecycleEnvelope({
    event: {
      eventType: TURN_EVENT.PROCESSING_STARTED,
      eventId: "multi-consumer-event",
      commandId: "multi-consumer-command",
      causationId: "multi-consumer-command",
      sessionId: "session-1",
      turnScopeId: "turn-1",
    },
    turn: {
      turnScopeId: "turn-1",
      commandId: "multi-consumer-command",
      presentationMessageId: "presentation-1",
      revision: 1,
      sequence: 1,
      phase: TURN_PHASE.PROCESSING,
      state: TURN_STATE.PROCESSING,
      updatedAt: "2026-07-18T00:00:00.000Z",
    },
  });
  const eventId = envelope.identity.eventId;
  const ack = (outbox, consumerId, deliveredAt) =>
    acknowledgeAuthorityEventDelivery(outbox, {
      eventId,
      consumerId,
      orderingDomain: envelope.ordering.domain,
      orderingScopeId: envelope.ordering.scopeId,
      sequence: envelope.ordering.sequence,
      deliveredAt,
    });
  const initial = normalizeAuthorityEventOutbox([{ eventId, envelope }]);
  const byCli = ack(initial, "service.cli", "2026-07-18T00:00:01.000Z");
  assert.equal(byCli.changed, true);
  assert.equal(listPendingAuthorityEvents(byCli.outbox, { consumerId: "service.cli" }).length, 0);
  assert.equal(
    listPendingAuthorityEvents(byCli.outbox, { consumerId: "service.websocket" }).length,
    1,
  );
  const byWeb = ack(byCli.outbox, "service.websocket", "2026-07-18T00:00:02.000Z");
  assert.equal(byWeb.changed, true);

  const projected = projectAuthorityOutboxJournal([
    { op: AUTHORITY_OUTBOX_JOURNAL_OP.COMMIT, eventId, envelope, committedAt: "" },
    { op: AUTHORITY_OUTBOX_JOURNAL_OP.ATTEMPT, eventId, attemptedAt: "legacy-no-consumer" },
    {
      op: AUTHORITY_OUTBOX_JOURNAL_OP.ATTEMPT,
      eventId,
      consumerId: "service.cli",
      attemptedAt: "t1",
    },
    {
      op: AUTHORITY_OUTBOX_JOURNAL_OP.ACK,
      eventId,
      consumerId: "service.cli",
      orderingDomain: envelope.ordering.domain,
      orderingScopeId: envelope.ordering.scopeId,
      sequence: envelope.ordering.sequence,
      deliveredAt: "2026-07-18T00:00:01.000Z",
    },
  ]);
  assert.deepEqual(Object.keys(projected[0].deliveries), ["service.cli"]);
  assert.equal(projected[0].deliveries["service.cli"].attempts, 1);
  assert.equal(
    listPendingAuthorityEvents(projected, { consumerId: "service.websocket" }).length,
    1,
  );
});

test("legacy single-slot outbox delivery migrates to the recorded consumer only", () => {
  const envelope = createCommittedTurnLifecycleEnvelope({
    event: {
      eventType: TURN_EVENT.PROCESSING_STARTED,
      eventId: "legacy-event",
      commandId: "legacy-command",
      causationId: "legacy-command",
      sessionId: "session-1",
      turnScopeId: "turn-1",
    },
    turn: {
      turnScopeId: "turn-1",
      commandId: "legacy-command",
      presentationMessageId: "presentation-1",
      revision: 1,
      sequence: 1,
      phase: TURN_PHASE.PROCESSING,
      state: TURN_STATE.PROCESSING,
      updatedAt: "2026-07-18T00:00:00.000Z",
    },
  });
  const [migrated, unowned] = migrateLegacyAuthorityEventOutbox([
    {
      eventId: "legacy-event",
      envelope,
      delivery: {
        attempts: 2,
        lastAttemptAt: "2026-07-18T00:00:01.000Z",
        deliveredAt: "2026-07-18T00:00:02.000Z",
        consumerId: "service.websocket",
        orderingDomain: envelope.ordering.domain,
        orderingScopeId: envelope.ordering.scopeId,
        sequence: envelope.ordering.sequence,
      },
    },
    {
      eventId: "legacy-event-2",
      envelope: { ...envelope, identity: { ...envelope.identity, eventId: "legacy-event-2" } },
      delivery: { attempts: 1 },
    },
  ]);
  assert.deepEqual(Object.keys(migrated.deliveries), ["service.websocket"]);
  assert.equal(migrated.deliveries["service.websocket"].attempts, 2);
  assert.equal(migrated.deliveries["service.websocket"].deliveredAt, "2026-07-18T00:00:02.000Z");
  assert.equal(unowned.eventId, "legacy-event-2");
  assert.deepEqual(unowned.deliveries, {});
});
