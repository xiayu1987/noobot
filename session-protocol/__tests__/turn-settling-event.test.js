/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  isRetryableFinalizeFailureEvent,
  isSettlingTurnEvent,
  TURN_EVENT,
  TURN_PHASE,
} from "../src/index.js";

const failed = (phase, retryable) => ({
  eventType: TURN_EVENT.FAILED,
  phase,
  failure: { code: "x", message: "x", retryable },
});

test("retryable finalize failure is a FAILED completion/stop event with retryable failure", () => {
  assert.equal(isRetryableFinalizeFailureEvent(failed(TURN_PHASE.COMPLETION, true)), true);
  assert.equal(isRetryableFinalizeFailureEvent(failed(TURN_PHASE.STOP, true)), true);
  assert.equal(isRetryableFinalizeFailureEvent(failed(TURN_PHASE.COMPLETION, false)), false);
  assert.equal(isRetryableFinalizeFailureEvent(failed(TURN_PHASE.PROCESSING, true)), false);
  assert.equal(isRetryableFinalizeFailureEvent(failed(TURN_PHASE.ACTION, true)), false);
  assert.equal(
    isRetryableFinalizeFailureEvent({
      eventType: TURN_EVENT.COMPLETED,
      phase: TURN_PHASE.COMPLETION,
    }),
    false,
  );
  assert.equal(isRetryableFinalizeFailureEvent(), false);
});

test("settling events are terminal events except retryable finalize failures", () => {
  assert.equal(isSettlingTurnEvent({ eventType: TURN_EVENT.COMPLETED }), true);
  assert.equal(isSettlingTurnEvent({ eventType: TURN_EVENT.STOP_COMPLETED }), true);
  assert.equal(isSettlingTurnEvent(failed(TURN_PHASE.PROCESSING, false)), true);
  assert.equal(isSettlingTurnEvent(failed(TURN_PHASE.PROCESSING, true)), true);
  assert.equal(isSettlingTurnEvent(failed(TURN_PHASE.COMPLETION, false)), true);
  assert.equal(isSettlingTurnEvent(failed(TURN_PHASE.COMPLETION, true)), false);
  assert.equal(isSettlingTurnEvent(failed(TURN_PHASE.STOP, true)), false);
  assert.equal(isSettlingTurnEvent({ eventType: TURN_EVENT.PROCESSING_COMPLETED }), false);
  assert.equal(isSettlingTurnEvent({ eventType: TURN_EVENT.ACTION_ACCEPTED }), false);
  assert.equal(isSettlingTurnEvent(), false);
});
