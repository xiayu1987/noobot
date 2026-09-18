/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveAuthoritativeTurnCapabilities,
  deriveTurnExecutionState,
  isTurnExecutionState,
  isUnsuccessfulTurnTerminalStatus,
  normalizeTurnExecutionState,
  TURN_EVENT,
  TURN_EXECUTION_STATE,
  TURN_EXECUTION_STATE_VALUES,
  TURN_STATE,
  TURN_TERMINAL_EVENTS,
  TURN_TERMINAL_STATUS,
  TURN_UNSUCCESSFUL_TERMINAL_STATUS,
} from "../src/index.js";

test("terminal turn events derive exactly the terminal execution states", () => {
  const derived = TURN_TERMINAL_EVENTS.map((eventType) => deriveTurnExecutionState(eventType, ""));
  assert.deepEqual(
    derived.sort(),
    [
      TURN_EXECUTION_STATE.COMPLETED,
      TURN_EXECUTION_STATE.ERROR,
      TURN_EXECUTION_STATE.USER_STOPPED,
    ].sort(),
  );
});

test("non terminal turn events keep the current execution state", () => {
  assert.equal(
    deriveTurnExecutionState(TURN_EVENT.ACTION_ACCEPTED, TURN_EXECUTION_STATE.SENDING),
    TURN_EXECUTION_STATE.SENDING,
  );
  assert.equal(deriveTurnExecutionState(TURN_EVENT.SNAPSHOT, "  SENDING  "), "sending");
});

test("execution state vocabulary is frozen and validated", () => {
  assert.equal(Object.isFrozen(TURN_EXECUTION_STATE), true);
  assert.equal(Object.isFrozen(TURN_EXECUTION_STATE_VALUES), true);
  for (const value of TURN_EXECUTION_STATE_VALUES) {
    assert.equal(isTurnExecutionState(value), true);
  }
  assert.equal(isTurnExecutionState("stopping"), false);
  assert.equal(isTurnExecutionState(""), false);
  assert.equal(normalizeTurnExecutionState("  ERROR "), TURN_EXECUTION_STATE.ERROR);
});

test("stop capability requires processing state with sending execution state", () => {
  assert.equal(
    deriveAuthoritativeTurnCapabilities({
      state: TURN_STATE.PROCESSING,
      executionState: `  ${TURN_EXECUTION_STATE.SENDING.toUpperCase()}  `,
    }).canStop,
    true,
  );
  assert.equal(
    deriveAuthoritativeTurnCapabilities({
      state: TURN_STATE.PROCESSING,
      executionState: TURN_EXECUTION_STATE.COMPLETED,
    }).canStop,
    false,
  );
});

test("unsuccessful terminal status is derived from the terminal status vocabulary", () => {
  assert.deepEqual(
    [...TURN_UNSUCCESSFUL_TERMINAL_STATUS].sort(),
    Object.values(TURN_TERMINAL_STATUS)
      .filter((status) => status !== TURN_TERMINAL_STATUS.COMPLETED)
      .sort(),
  );
  assert.equal(Object.isFrozen(TURN_UNSUCCESSFUL_TERMINAL_STATUS), true);
  assert.equal(isUnsuccessfulTurnTerminalStatus(TURN_TERMINAL_STATUS.COMPLETED), false);
  assert.equal(isUnsuccessfulTurnTerminalStatus(`  ${TURN_TERMINAL_STATUS.TIMEOUT}  `), true);
  assert.equal(isUnsuccessfulTurnTerminalStatus(""), false);
});
