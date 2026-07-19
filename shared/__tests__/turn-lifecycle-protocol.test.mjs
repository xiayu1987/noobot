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
} from "../turn-lifecycle-protocol.mjs";

test("turn lifecycle envelope requires stable identity and monotonic coordinates", () => {
  const envelope = createTurnLifecycleEnvelope({
    eventType: TURN_EVENT.PROCESSING_STARTED,
    eventId: "evt-1",
    commandId: "cmd-1",
    sessionId: "session-1",
    turnScopeId: "turn-1",
    revision: 2,
    sequence: 2,
    phase: TURN_PHASE.PROCESSING,
    state: TURN_STATE.PROCESSING,
  });
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
  assert.deepEqual(result.errors, ["missing_session_id", "missing_turn_scope_id", "invalid_revision"]);
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
