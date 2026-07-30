/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  TURN_EVENT,
  TURN_PHASE,
  TURN_STATE,
  createTurnLifecycleEnvelope,
  deriveAuthoritativeTurnCapabilities,
  validateTurnLifecycleEnvelope,
  validateSessionProvisionIntent,
} from "../src/contracts/turn-lifecycle-protocol.mjs";
import {
  acknowledgeAuthorityEventDelivery,
  compactAuthorityEventOutbox,
  listPendingAuthorityEvents,
  normalizeAuthorityEventOutbox,
  recordAuthorityEventDeliveryAttempt,
} from "../src/contracts/authority-event-outbox.mjs";
import { commitTurnLifecycle } from "../src/application/commit-turn-lifecycle.js";

test("turn lifecycle envelope requires stable identity and monotonic coordinates", () => {
  const envelope = createTurnLifecycleEnvelope({
    eventType: TURN_EVENT.PROCESSING_STARTED,
    eventId: "evt-1",
    commandId: "cmd-1",
    sessionId: "session-1",
    turnScopeId: "turn-1",
    messageId: "turn-message-1",
    presentationMessageId: "assistant-1",
    revision: 2,
    sequence: 2,
    phase: TURN_PHASE.PROCESSING,
    state: TURN_STATE.PROCESSING,
  });
  assert.deepEqual(validateTurnLifecycleEnvelope(envelope), { valid: true, errors: [] });
  assert.equal(envelope.presentationMessageId, "assistant-1");
  assert.equal(envelope.messageId, "turn-message-1");
});

test("authority outbox tracks attempts and acknowledges delivery idempotently", () => {
  const envelope = createTurnLifecycleEnvelope({
    eventType: TURN_EVENT.PROCESSING_STARTED,
    eventId: "outbox-event-1",
    commandId: "outbox-command-1",
    sessionId: "outbox-session-1",
    turnScopeId: "outbox-turn-1",
    messageId: "outbox-message-1",
    presentationMessageId: "outbox-presentation-1",
    revision: 1,
    sequence: 1,
    phase: TURN_PHASE.PROCESSING,
    state: TURN_STATE.PROCESSING,
  });
  const initial = normalizeAuthorityEventOutbox([{ eventId: envelope.eventId, envelope, committedAt: envelope.updatedAt }]);
  assert.equal(listPendingAuthorityEvents(initial).length, 1);
  const attempted = recordAuthorityEventDeliveryAttempt(initial, {
    eventId: envelope.eventId,
    attemptedAt: "2026-07-18T00:00:01.000Z",
  });
  assert.equal(attempted.found, true);
  assert.equal(attempted.outbox[0].delivery.attempts, 1);
  const acknowledged = acknowledgeAuthorityEventDelivery(attempted.outbox, {
    eventId: envelope.eventId,
    deliveredAt: "2026-07-18T00:00:02.000Z",
  });
  assert.equal(acknowledged.changed, true);
  assert.equal(listPendingAuthorityEvents(acknowledged.outbox).length, 0);
  const replay = acknowledgeAuthorityEventDelivery(acknowledged.outbox, {
    eventId: envelope.eventId,
    deliveredAt: "2026-07-18T00:00:03.000Z",
  });
  assert.equal(replay.found, true);
  assert.equal(replay.changed, false);
  assert.equal(replay.outbox[0].delivery.deliveredAt, "2026-07-18T00:00:02.000Z");
});

test("durable command receipt returns the original envelope after outbox compaction", () => {
  const event = {
    eventType: TURN_EVENT.ACTION_ACCEPTED,
    commandId: "durable-command-1",
    userId: "user-1",
    sessionId: "session-1",
    turnScopeId: "turn-1",
    messageId: "message-1",
    presentationMessageId: "presentation-1",
    action: "send",
    phase: TURN_PHASE.ACTION,
    expectedRevision: 0,
  };
  const committed = commitTurnLifecycle({
    lifecycle: {}, event, createEventId: () => "durable-event-1",
    now: () => "2026-07-18T00:00:00.000Z",
  });
  assert.equal(committed.applied, true);
  assert.equal(committed.lifecycle.commandReceipts[0].eventId, "durable-event-1");
  assert.equal(committed.lifecycle.commandReceipts[0].envelope.eventId, "durable-event-1");

  const delivered = acknowledgeAuthorityEventDelivery(committed.eventOutbox, {
    eventId: "durable-event-1",
    deliveredAt: "2026-07-18T00:00:01.000Z",
  }).outbox;
  const compacted = compactAuthorityEventOutbox(delivered, {
    deliveredThroughSequence: 1,
    retainDeliveredAfter: "2026-07-19T00:00:00.000Z",
    commandReceipts: committed.lifecycle.commandReceipts,
  });
  assert.equal(compacted.removed, 1);
  assert.deepEqual(compacted.outbox, []);

  const replay = commitTurnLifecycle({
    lifecycle: committed.lifecycle,
    event,
    eventOutbox: compacted.outbox,
    createEventId: () => "must-not-be-used",
  });
  assert.equal(replay.deduplicated, true);
  assert.equal(replay.envelope.eventId, "durable-event-1");
});

test("outbox compaction never removes pending, unreceipted, recent or above-watermark events", () => {
  const envelope = (eventId, sequence) => createTurnLifecycleEnvelope({
    eventType: TURN_EVENT.PROCESSING_STARTED,
    eventId,
    commandId: `command-${eventId}`,
    sessionId: "session-1",
    turnScopeId: "turn-1",
    messageId: "message-1",
    presentationMessageId: "presentation-1",
    revision: sequence,
    sequence,
    phase: TURN_PHASE.PROCESSING,
    state: TURN_STATE.PROCESSING,
  });
  const source = [
    { eventId: "pending", envelope: envelope("pending", 1), committedAt: "2026-07-01T00:00:00.000Z" },
    { eventId: "unreceipted", envelope: envelope("unreceipted", 2), committedAt: "2026-07-01T00:00:00.000Z", deliveredAt: "2026-07-02T00:00:00.000Z" },
    { eventId: "recent", envelope: envelope("recent", 3), committedAt: "2026-07-01T00:00:00.000Z", deliveredAt: "2026-07-20T00:00:00.000Z" },
    { eventId: "above-watermark", envelope: envelope("above-watermark", 4), committedAt: "2026-07-01T00:00:00.000Z", deliveredAt: "2026-07-02T00:00:00.000Z" },
  ];
  const receipts = source.slice(2).map((item) => ({
    commandId: item.envelope.commandId,
    eventType: item.envelope.eventType,
    eventId: item.eventId,
    envelope: item.envelope,
  }));
  const result = compactAuthorityEventOutbox(source, {
    deliveredThroughSequence: 3,
    retainDeliveredAfter: "2026-07-10T00:00:00.000Z",
    commandReceipts: receipts,
  });
  assert.equal(result.removed, 0);
  assert.deepEqual(result.outbox.map((item) => item.eventId), ["pending", "unreceipted", "recent", "above-watermark"]);
});

test("turn lifecycle envelope preserves parent identity without leaking mutation intents", () => {
  const envelope = createTurnLifecycleEnvelope({
    eventType: TURN_EVENT.ACTION_ACCEPTED,
    eventId: "evt-child",
    commandId: "cmd-child",
    sessionId: "child-session",
    parentSessionId: "parent-session",
    turnScopeId: "child-turn",
    messageId: "child-turn-message",
    presentationMessageId: "child-presentation",
    revision: 1,
    sequence: 1,
    phase: TURN_PHASE.ACTION,
    state: TURN_STATE.ACTION_REQUESTING,
    createSessionIfAbsent: true,
    finalizeIntent: { requested: true },
  });
  assert.equal(envelope.parentSessionId, "parent-session");
  assert.equal("createSessionIfAbsent" in envelope, false);
  assert.equal("finalizeIntent" in envelope, false);
  assert.deepEqual(validateTurnLifecycleEnvelope(envelope), { valid: true, errors: [] });
});

test("turn lifecycle envelope rejects missing identity and invalid revision", () => {
  const result = validateTurnLifecycleEnvelope(createTurnLifecycleEnvelope({
    eventType: TURN_EVENT.FAILED,
    eventId: "evt-2",
    revision: 0,
    sequence: 1,
  }));
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, [
    "missing_session_id",
    "missing_turn_scope_id",
    "missing_message_id",
    "missing_presentation_message_id",
    "invalid_revision",
  ]);
});

test("only authoritative processing/sending is stoppable", () => {
  assert.equal(deriveAuthoritativeTurnCapabilities({
    state: TURN_STATE.PROCESSING,
    executionState: "sending",
  }).canStop, true);
  for (const executionState of ["reconnecting", "interaction_pending", "stopping"]) {
    assert.equal(deriveAuthoritativeTurnCapabilities({
      state: TURN_STATE.PROCESSING,
      executionState,
    }).canStop, false);
  }
  assert.equal(deriveAuthoritativeTurnCapabilities({
    state: TURN_STATE.COMPLETION_REQUESTING,
    executionState: "sending",
  }).canStop, false);
});

test("session provision intent is explicit and restricted to the first send acceptance", () => {
  assert.deepEqual(validateSessionProvisionIntent({
    createSessionIfAbsent: true,
    eventType: TURN_EVENT.ACTION_ACCEPTED,
    action: "send",
    expectedRevision: 0,
  }), { valid: true, requested: true, errors: [] });
  for (const input of [
    { createSessionIfAbsent: "true", eventType: TURN_EVENT.ACTION_ACCEPTED, action: "send" },
    { createSessionIfAbsent: true, eventType: TURN_EVENT.ACTION_ACCEPTED, action: "resend" },
    { createSessionIfAbsent: true, eventType: TURN_EVENT.PROCESSING_STARTED, action: "send" },
    { createSessionIfAbsent: true, eventType: TURN_EVENT.ACTION_ACCEPTED, action: "send", expectedRevision: 1 },
  ]) assert.equal(validateSessionProvisionIntent(input).valid, false);
});
