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
