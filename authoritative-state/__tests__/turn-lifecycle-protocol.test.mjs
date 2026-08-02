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
  createTurnLifecycleReceipt,
  deriveAuthoritativeTurnCapabilities,
  validateTurnLifecycleEnvelope,
  validateTurnLifecycleReceipt,
  validateSessionProvisionIntent,
} from "@noobot/event-protocol/turn-lifecycle";

import {
  acknowledgeAuthorityEventDelivery,
  compactAuthorityEventOutbox,
  listPendingAuthorityEvents,
  normalizeAuthorityEventOutbox,
  recordAuthorityEventDeliveryAttempt,
} from "@noobot/event-protocol/outbox";
import { commitTurnLifecycle } from "../src/application/commit-turn-lifecycle.js";
import { transitionTurnLifecycle } from "../src/domain/turn-lifecycle-entity.js";

test("turn lifecycle receipt identifies one authoritative delivery without carrying state", () => {
  const receipt = createTurnLifecycleReceipt({
    eventId: "evt-receipt-1",
    sessionId: "session-receipt-1",
    turnScopeId: "turn-receipt-1",
  });
  assert.deepEqual(validateTurnLifecycleReceipt(receipt), { valid: true, errors: [] });
  assert.deepEqual(Object.keys(receipt).sort(), [
    "action",
    "eventId",
    "protocolVersion",
    "sessionId",
    "turnScopeId",
  ]);
  assert.equal(validateTurnLifecycleReceipt({ ...receipt, eventId: "" }).valid, false);
  assert.deepEqual(
    validateTurnLifecycleReceipt({
      ...receipt,
      turnScopeId: "workflow-node_workflow_client-turn_1",
    }).errors,
    ["non_canonical_turn_scope_id"],
  );
});

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

test("turn lifecycle envelope carries only a serializable scoped persistence locator", () => {
  const persistenceScope = {
    scopeId: "agent:node-1",
    parentSessionId: "root-session",
    relativeDir: "runtime/plugin/session/root/node-1",
    allowedRoot: "runtime/plugin/session",
  };
  const envelope = createTurnLifecycleEnvelope({
    eventType: TURN_EVENT.PROCESSING_STARTED,
    eventId: "evt-scoped",
    commandId: "cmd-scoped",
    sessionId: "child-session",
    turnScopeId: "turn-scoped",
    messageId: "message-scoped",
    presentationMessageId: "presentation-scoped",
    revision: 2,
    sequence: 2,
    phase: TURN_PHASE.PROCESSING,
    state: TURN_STATE.PROCESSING,
    persistenceScope,
  });
  assert.deepEqual(envelope.persistenceScope, persistenceScope);
  assert.equal(Object.isFrozen(envelope.persistenceScope), true);
  assert.deepEqual(validateTurnLifecycleEnvelope(envelope), { valid: true, errors: [] });
  assert.equal(validateTurnLifecycleEnvelope({ ...envelope, persistenceScope: {} }).valid, false);
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
    "event_phase_mismatch",
    "event_state_mismatch",
  ]);
});

test("action acceptance enforces one continuation source contract", () => {
  const base = {
    eventType: TURN_EVENT.ACTION_ACCEPTED,
    eventId: "continue-contract-event",
    commandId: "continue-contract-command",
    sessionId: "continue-contract-session",
    turnScopeId: "continue-contract-turn",
    messageId: "continue-contract-message",
    presentationMessageId: "continue-contract-presentation",
    revision: 1,
    sequence: 1,
    phase: TURN_PHASE.ACTION,
    state: TURN_STATE.ACTION_REQUESTING,
  };
  const missingSource = createTurnLifecycleEnvelope({ ...base, action: "continue" });
  assert.deepEqual(validateTurnLifecycleEnvelope(missingSource), {
    valid: false,
    errors: ["missing_continuation_source"],
  });
  const unexpectedSource = createTurnLifecycleEnvelope({
    ...base,
    action: "send",
    continuationSource: { turnScopeId: "stopped-turn", dialogProcessId: "stopped-dialog" },
  });
  assert.deepEqual(validateTurnLifecycleEnvelope(unexpectedSource), {
    valid: false,
    errors: ["unexpected_continuation_source"],
  });
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

test("execution identity is immutable after the first Turn revision", () => {
  const accepted = transitionTurnLifecycle({}, {
    eventType: TURN_EVENT.ACTION_ACCEPTED,
    commandId: "identity-r1",
    turnScopeId: "identity-turn",
    phase: TURN_PHASE.ACTION,
    action: "send",
    messageId: "identity-message",
    presentationMessageId: "identity-presentation",
    executionId: "workflow:identity-turn",
    executionKind: "workflow",
    rootExecutionId: "workflow:identity-turn",
    origin: { type: "workflow", workflowRunId: "workflow:identity-turn" },
  });
  assert.equal(accepted.applied, true);
  const conflict = transitionTurnLifecycle(accepted.lifecycle, {
    eventType: TURN_EVENT.PROCESSING_STARTED,
    commandId: "identity-r2",
    turnScopeId: "identity-turn",
    phase: TURN_PHASE.PROCESSING,
    executionId: "agent:identity-turn",
    executionKind: "agent",
  });
  assert.equal(conflict.applied, false);
  assert.equal(conflict.reason, "execution_identity_conflict");
  assert.equal(conflict.lifecycle.turns["identity-turn"].revision, 1);
});

test("continuation consumes the exact stopped Turn atomically and advances as one chain", () => {
  const transition = (lifecycle, input) => {
    const result = transitionTurnLifecycle(lifecycle, input, () => "2026-07-31T00:00:00.000Z");
    assert.equal(result.applied, true, result.reason);
    return result.lifecycle;
  };
  const identity = (turnScopeId, dialogProcessId) => ({
    turnScopeId,
    dialogProcessId,
    messageId: `message-${turnScopeId}`,
    presentationMessageId: `presentation-${turnScopeId}`,
  });
  const stop = (lifecycle, turnScopeId, dialogProcessId, commandPrefix) => {
    let next = transition(lifecycle, {
      ...identity(turnScopeId, dialogProcessId),
      eventType: TURN_EVENT.PROCESSING_STARTED,
      commandId: `${commandPrefix}:processing`,
      phase: TURN_PHASE.PROCESSING,
      executionState: "sending",
    });
    next = transition(next, {
      ...identity(turnScopeId, dialogProcessId),
      eventType: TURN_EVENT.STOP_ACCEPTED,
      commandId: `${commandPrefix}:stop`,
      phase: TURN_PHASE.STOP,
    });
    next = transition(next, {
      ...identity(turnScopeId, dialogProcessId),
      eventType: TURN_EVENT.STOP_PROCESSING_COMPLETED,
      commandId: `${commandPrefix}:stop-processing-completed`,
      phase: TURN_PHASE.STOP,
    });
    return transition(next, {
      ...identity(turnScopeId, dialogProcessId),
      eventType: TURN_EVENT.STOP_COMPLETED,
      commandId: `${commandPrefix}:stop-completed`,
      phase: TURN_PHASE.STOP,
      executionState: "user_stopped",
    });
  };

  let lifecycle = transition({}, {
    ...identity("turn-a", "dialog-a"),
    eventType: TURN_EVENT.ACTION_ACCEPTED,
    commandId: "turn-a:accepted",
    phase: TURN_PHASE.ACTION,
    action: "send",
  });
  lifecycle = stop(lifecycle, "turn-a", "dialog-a", "turn-a");
  lifecycle = transition(lifecycle, {
    ...identity("turn-b", "dialog-b"),
    eventType: TURN_EVENT.ACTION_ACCEPTED,
    commandId: "turn-b:accepted",
    phase: TURN_PHASE.ACTION,
    action: "continue",
    continuationSource: { turnScopeId: "turn-a", dialogProcessId: "dialog-a" },
  });
  assert.equal(lifecycle.turns["turn-a"].continuedByTurnScopeId, "turn-b");
  assert.deepEqual(lifecycle.turns["turn-b"].continuationSource, {
    turnScopeId: "turn-a",
    dialogProcessId: "dialog-a",
  });

  lifecycle = stop(lifecycle, "turn-b", "dialog-b", "turn-b");
  const duplicateSource = transitionTurnLifecycle(lifecycle, {
    ...identity("turn-c", "dialog-c"),
    eventType: TURN_EVENT.ACTION_ACCEPTED,
    commandId: "turn-c:wrong-source",
    phase: TURN_PHASE.ACTION,
    action: "continue",
    continuationSource: { turnScopeId: "turn-a", dialogProcessId: "dialog-a" },
  });
  assert.equal(duplicateSource.applied, false);
  assert.equal(duplicateSource.reason, "continue_source_consumed");
  assert.equal(duplicateSource.lifecycle.turns["turn-c"], undefined);
  assert.equal(duplicateSource.lifecycle.turns["turn-a"].continuedByTurnScopeId, "turn-b");

  lifecycle = transition(lifecycle, {
    ...identity("turn-c", "dialog-c"),
    eventType: TURN_EVENT.ACTION_ACCEPTED,
    commandId: "turn-c:accepted",
    phase: TURN_PHASE.ACTION,
    action: "continue",
    continuationSource: { turnScopeId: "turn-b", dialogProcessId: "dialog-b" },
  });
  assert.equal(lifecycle.turns["turn-b"].continuedByTurnScopeId, "turn-c");
  assert.equal(lifecycle.activeTurnScopeId, "turn-c");
});
