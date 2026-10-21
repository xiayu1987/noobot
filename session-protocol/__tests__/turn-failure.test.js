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
  normalizeTurnFailure,
  validateTurnLifecycleEnvelope,
} from "../src/index.js";
import { snapshotTurn } from "../src/lifecycle/turn-projection.js";

test("turn failure carries only code, message and retryable", () => {
  assert.deepEqual(
    normalizeTurnFailure({ phase: "processing", code: "x", message: "m", retryable: true }),
    { code: "x", message: "m", retryable: true },
  );
  assert.deepEqual(normalizeTurnFailure({ code: "x", message: "m" }), {
    code: "x",
    message: "m",
    retryable: false,
  });
  assert.equal(normalizeTurnFailure(null), null);
  assert.equal(normalizeTurnFailure([]), null);
});

test("snapshotTurn drops failure.phase; phase stays on the turn", () => {
  const snapshot = snapshotTurn({
    turnScopeId: "turn:t1",
    phase: TURN_PHASE.PROCESSING,
    failure: { phase: TURN_PHASE.PROCESSING, code: "x", message: "m", retryable: false },
  });
  assert.equal(snapshot.phase, TURN_PHASE.PROCESSING);
  assert.equal(Object.hasOwn(snapshot.failure, "phase"), false);
});

test("FAILED envelope phase is read only from the top-level field", () => {
  const base = {
    eventType: TURN_EVENT.FAILED,
    eventId: "e1",
    sessionId: "s1",
    turnScopeId: "turn:t1",
    presentationMessageId: "p1",
    revision: 1,
    sequence: 1,
    state: TURN_STATE.PROCESSING_FAILED,
    failure: { phase: TURN_PHASE.PROCESSING, code: "x", message: "m" },
  };
  const withoutPhase = { ...createTurnLifecycleEnvelope(base), phase: "" };
  assert.ok(validateTurnLifecycleEnvelope(withoutPhase).errors.includes("event_phase_mismatch"));
  const envelope = createTurnLifecycleEnvelope({ ...base, phase: TURN_PHASE.PROCESSING });
  assert.equal(Object.hasOwn(envelope.failure, "phase"), false);
  assert.equal(
    validateTurnLifecycleEnvelope(envelope).errors.includes("event_phase_mismatch"),
    false,
  );
});
