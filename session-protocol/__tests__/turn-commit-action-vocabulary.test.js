/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  isTurnCommitContinuation,
  normalizeTurnCommitMetadata,
  normalizeTurnCommitAction,
  requireTurnCommitAction,
  TURN_COMMIT_ACTION,
  TURN_COMMIT_ACTION_VALUES,
  TURN_PHASE,
  validateTurnCommitMetadata,
} from "../src/index.js";

test("commit action vocabulary is frozen and exhaustive", () => {
  assert.equal(Object.isFrozen(TURN_COMMIT_ACTION), true);
  assert.equal(Object.isFrozen(TURN_COMMIT_ACTION_VALUES), true);
  assert.deepEqual([...TURN_COMMIT_ACTION_VALUES].sort(), ["continue", "send"]);
});

test("commit action axis does not intersect the turn phase axis", () => {
  const phases = new Set(Object.values(TURN_PHASE));
  for (const value of TURN_COMMIT_ACTION_VALUES) {
    assert.equal(phases.has(value), false);
  }
});

test("commit action normalization trims and lowercases", () => {
  assert.equal(normalizeTurnCommitAction("  CONTINUE  "), TURN_COMMIT_ACTION.CONTINUE);
  assert.equal(normalizeTurnCommitAction("  Send "), TURN_COMMIT_ACTION.SEND);
  assert.equal(normalizeTurnCommitAction(""), "");
});

test("commit action requirement accepts only protocol commit actions", () => {
  assert.equal(requireTurnCommitAction("  CONTINUE "), TURN_COMMIT_ACTION.CONTINUE);
  assert.equal(requireTurnCommitAction(TURN_COMMIT_ACTION.SEND), TURN_COMMIT_ACTION.SEND);
  for (const invalid of ["", "unknown", "resend", undefined]) {
    assert.throws(() => requireTurnCommitAction(invalid), { code: "TURN_COMMIT_ACTION_INVALID" });
  }
});

test("turn commit metadata rejects a missing or unknown action instead of defaulting", () => {
  assert.throws(() => normalizeTurnCommitMetadata({ commandId: "c1" }), {
    code: "TURN_COMMIT_ACTION_INVALID",
  });
  assert.deepEqual(validateTurnCommitMetadata({ commandId: "c1", action: "resend" }).errors, [
    "invalid_turn_commit_action",
  ]);
});

test("continuation predicate matches only the continue action", () => {
  assert.equal(isTurnCommitContinuation(`  ${TURN_COMMIT_ACTION.CONTINUE.toUpperCase()}  `), true);
  assert.equal(isTurnCommitContinuation(TURN_COMMIT_ACTION.SEND), false);
  assert.equal(isTurnCommitContinuation(""), false);
  assert.equal(isTurnCommitContinuation(null), false);
});
