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
  decideTurnTransition,
  isTurnEventPhase,
} from "@noobot/session-protocol";

const EVENT_PHASE_CASES = [
  [TURN_EVENT.ACTION_ACCEPTED, TURN_PHASE.ACTION],
  [TURN_EVENT.PROCESSING_STARTED, TURN_PHASE.PROCESSING],
  [TURN_EVENT.PROCESSING_COMPLETED, TURN_PHASE.COMPLETION],
  [TURN_EVENT.STOP_ACCEPTED, TURN_PHASE.STOP],
  [TURN_EVENT.STOP_PROCESSING_COMPLETED, TURN_PHASE.STOP],
  [TURN_EVENT.COMPLETED, TURN_PHASE.COMPLETION],
  [TURN_EVENT.STOP_COMPLETED, TURN_PHASE.STOP],
];

test("each non-failure turn event accepts exactly its protocol phase", () => {
  for (const [eventType, phase] of EVENT_PHASE_CASES) {
    assert.equal(isTurnEventPhase(eventType, phase), true, `${eventType}:${phase}`);
    for (const other of Object.values(TURN_PHASE).filter((value) => value !== phase)) {
      assert.equal(isTurnEventPhase(eventType, other), false, `${eventType}:${other}`);
    }
    assert.equal(isTurnEventPhase(eventType, ""), false);
  }
});

test("failed event accepts every turn phase and rejects unknown phases", () => {
  for (const phase of Object.values(TURN_PHASE)) {
    assert.equal(isTurnEventPhase(TURN_EVENT.FAILED, phase), true);
  }
  assert.equal(isTurnEventPhase(TURN_EVENT.FAILED, ""), false);
  assert.equal(isTurnEventPhase(TURN_EVENT.FAILED, "turn"), false);
  assert.equal(isTurnEventPhase("unknown_event", TURN_PHASE.ACTION), false);
});

test("turn transition rejects a phase that does not belong to the event", () => {
  const current = { state: TURN_STATE.PROCESSING, action: "send", executionState: "sending" };
  assert.deepEqual(
    decideTurnTransition({
      current,
      eventType: TURN_EVENT.STOP_ACCEPTED,
      phase: TURN_PHASE.ACTION,
    }),
    { allowed: false, reason: "invalid_turn_phase" },
  );
  assert.deepEqual(decideTurnTransition({ current, eventType: TURN_EVENT.FAILED, phase: "turn" }), {
    allowed: false,
    reason: "invalid_turn_phase",
  });
  assert.equal(
    decideTurnTransition({ current, eventType: TURN_EVENT.STOP_ACCEPTED, phase: TURN_PHASE.STOP })
      .allowed,
    true,
  );
});
