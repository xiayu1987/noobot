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
  createTurnLifecycleSnapshot,
  createTurnLifecycleReceipt,
  deriveAuthoritativeTurnCapabilities,
  validateTurnLifecycleEnvelope,
  validateTurnLifecycleSnapshot,
  validateTurnLifecycleReceipt,
  validateSessionProvisionIntent,
} from "../src/turn-lifecycle-protocol.mjs";

test("turn lifecycle snapshot carries authoritative replacement tombstones", () => {
  const snapshot = createTurnLifecycleSnapshot({
    commandId: "snapshot-replacement-1",
    sessionId: "session-replacement-1",
    sequence: 8,
    replacedTurns: [{
      turnScopeId: "turn-old",
      replacementTurnScopeId: "turn-new",
      replacementUserMessageId: "user-new",
      commandId: "replace-command-1",
      committedVersion: 4,
      replacedTurnScopeIds: ["turn-old", "turn-tail"],
      sequence: 8,
      committedAt: "2026-08-02T10:00:00.000Z",
    }, {
      turnScopeId: "turn-tail",
      replacementTurnScopeId: "turn-new",
      replacementUserMessageId: "user-new",
      commandId: "replace-command-1",
      committedVersion: 4,
      replacedTurnScopeIds: ["turn-old", "turn-tail"],
      sequence: 8,
      committedAt: "2026-08-02T10:00:00.000Z",
    }],
  });

  assert.deepEqual(validateTurnLifecycleSnapshot(snapshot), { valid: true, errors: [] });
  assert.deepEqual(snapshot.replacedTurns.map((item) => item.turnScopeId), ["turn-old", "turn-tail"]);
  assert.deepEqual(
    validateTurnLifecycleSnapshot({ ...snapshot, replacedTurns: undefined }).errors,
    ["missing_replaced_turns"],
  );
  assert.deepEqual(
    validateTurnLifecycleSnapshot({
      ...snapshot,
      activeTurnScopeId: "turn-old",
      activeTurn: {
        turnScopeId: "turn-old",
        messageId: "message-old",
        presentationMessageId: "presentation-old",
        revision: 1,
        sequence: 7,
      },
    }).errors,
    ["replaced_turn_still_materialized"],
  );
});

import {
  acknowledgeAuthorityEventDelivery,
  compactAuthorityEventOutbox,
  listPendingAuthorityEvents,
  normalizeAuthorityEventOutbox,
  recordAuthorityEventDeliveryAttempt,
} from "../src/authority-event-outbox.mjs";

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

test("turn lifecycle envelope rejects event, phase and state contradictions", () => {
  const envelope = createTurnLifecycleEnvelope({
    eventType: TURN_EVENT.COMPLETED,
    eventId: "evt-completed-contract",
    commandId: "cmd-completed-contract",
    sessionId: "session-completed-contract",
    turnScopeId: "turn-completed-contract",
    messageId: "message-completed-contract",
    presentationMessageId: "presentation-completed-contract",
    revision: 4,
    sequence: 4,
    phase: TURN_PHASE.COMPLETION,
    state: TURN_STATE.COMPLETED,
    completionCommitId: "commit-completed-contract",
    summaryVersion: 1,
  });
  assert.deepEqual(validateTurnLifecycleEnvelope(envelope), { valid: true, errors: [] });
  assert.deepEqual(validateTurnLifecycleEnvelope({ ...envelope, phase: TURN_PHASE.PROCESSING }).errors, [
    "event_phase_mismatch",
  ]);
  assert.deepEqual(validateTurnLifecycleEnvelope({ ...envelope, state: TURN_STATE.PROCESSING }).errors, [
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
