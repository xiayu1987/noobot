/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveTurnState,
  isFailedTurnState,
  isTerminalTurnEvent,
  isTerminalTurnState,
  isUnsuccessfulTurnState,
  TURN_EVENT,
  TURN_EVENT_VALUES,
  TURN_FAILED_STATES,
  TURN_PHASE,
  TURN_STATE,
  TURN_TERMINAL_EVENTS,
} from "../src/index.js";
import { isLifecycleTerminalCandidate } from "../src/lifecycle-terminal-index.js";

test("message-free terminal indexing follows lifecycle state without terminal details", () => {
  const unsuccessful = new Set([
    "stop_completed",
    "action_failed",
    "processing_failed",
    "completion_failed",
    "stop_failed",
  ]);
  for (const state of [...Object.values(TURN_STATE), "", undefined, "unknown"]) {
    const turn = { state, terminalStatus: null, executionState: "completed" };
    assert.equal(isUnsuccessfulTurnState(state), unsuccessful.has(state), String(state));
    assert.equal(isLifecycleTerminalCandidate(turn, false), unsuccessful.has(state), String(state));
    assert.equal(
      isLifecycleTerminalCandidate(turn, true),
      unsuccessful.has(state) || state === "completed",
      String(state),
    );
  }
  assert.equal(isLifecycleTerminalCandidate(null, true), false);
});

test("terminal turn events cover exactly the events that derive terminal states", () => {
  const derivedTerminalEvents = TURN_EVENT_VALUES.filter((eventType) =>
    Object.values(TURN_PHASE).some((phase) =>
      isTerminalTurnState(deriveTurnState(eventType, phase)),
    ),
  );
  assert.deepEqual([...TURN_TERMINAL_EVENTS].sort(), derivedTerminalEvents.sort());
});

test("every terminal turn event derives a terminal state for its own phase", () => {
  assert.equal(
    isTerminalTurnState(deriveTurnState(TURN_EVENT.COMPLETED, TURN_PHASE.COMPLETION)),
    true,
  );
  assert.equal(
    isTerminalTurnState(deriveTurnState(TURN_EVENT.STOP_COMPLETED, TURN_PHASE.STOP)),
    true,
  );
  for (const phase of Object.values(TURN_PHASE)) {
    assert.equal(isTerminalTurnState(deriveTurnState(TURN_EVENT.FAILED, phase)), true);
  }
});

test("failed turn states are exactly the states derived from the failed event", () => {
  const derivedFailedStates = Object.values(TURN_PHASE).map((phase) =>
    deriveTurnState(TURN_EVENT.FAILED, phase),
  );
  assert.deepEqual([...TURN_FAILED_STATES].sort(), derivedFailedStates.sort());
});

test("failed turn states are a strict subset of terminal turn states", () => {
  for (const state of TURN_FAILED_STATES) {
    assert.equal(isFailedTurnState(state), true);
    assert.equal(isTerminalTurnState(state), true);
  }
  assert.equal(isFailedTurnState(TURN_STATE.COMPLETED), false);
  assert.equal(isFailedTurnState(TURN_STATE.STOP_COMPLETED), false);
});

test("terminal predicates reject non terminal and blank input", () => {
  assert.equal(isTerminalTurnEvent(TURN_EVENT.ACTION_ACCEPTED), false);
  assert.equal(isTerminalTurnEvent(TURN_EVENT.SNAPSHOT), false);
  assert.equal(isTerminalTurnEvent(""), false);
  assert.equal(isTerminalTurnEvent(undefined), false);
  assert.equal(isFailedTurnState(""), false);
  assert.equal(isFailedTurnState(undefined), false);
});

test("terminal predicates trim surrounding whitespace", () => {
  assert.equal(isTerminalTurnEvent(`  ${TURN_EVENT.COMPLETED}  `), true);
  assert.equal(isFailedTurnState(`  ${TURN_STATE.STOP_FAILED}  `), true);
});

test("terminal vocabularies are frozen", () => {
  assert.equal(Object.isFrozen(TURN_TERMINAL_EVENTS), true);
  assert.equal(Object.isFrozen(TURN_FAILED_STATES), true);
});
