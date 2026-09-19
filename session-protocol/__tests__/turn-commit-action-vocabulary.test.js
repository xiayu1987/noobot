/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  isTurnCommitAction,
  isTurnCommitContinuation,
  normalizeTurnCommitAction,
  resolveTurnCommitAction,
  TURN_COMMIT_ACTION,
  TURN_COMMIT_ACTION_VALUES,
  TURN_EXECUTION_STATE_VALUES,
  TURN_PHASE,
} from "../src/index.js";

test("commit action vocabulary is frozen and exhaustive", () => {
  assert.equal(Object.isFrozen(TURN_COMMIT_ACTION), true);
  assert.equal(Object.isFrozen(TURN_COMMIT_ACTION_VALUES), true);
  assert.deepEqual([...TURN_COMMIT_ACTION_VALUES].sort(), ["continue", "send"]);
  for (const value of TURN_COMMIT_ACTION_VALUES) {
    assert.equal(isTurnCommitAction(value), true);
  }
});

test("commit action rejects values from other vocabularies", () => {
  assert.equal(isTurnCommitAction(""), false);
  assert.equal(isTurnCommitAction("stop"), false);
  assert.equal(isTurnCommitAction("resend"), false);
  for (const value of TURN_EXECUTION_STATE_VALUES) {
    assert.equal(isTurnCommitAction(value), false);
  }
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

test("commit action resolution defaults every non continue input to send", () => {
  assert.equal(resolveTurnCommitAction("  CONTINUE "), TURN_COMMIT_ACTION.CONTINUE);
  assert.equal(resolveTurnCommitAction(TURN_COMMIT_ACTION.SEND), TURN_COMMIT_ACTION.SEND);
  assert.equal(resolveTurnCommitAction(""), TURN_COMMIT_ACTION.SEND);
  assert.equal(resolveTurnCommitAction("unknown"), TURN_COMMIT_ACTION.SEND);
  assert.equal(resolveTurnCommitAction(undefined), TURN_COMMIT_ACTION.SEND);
});

test("continuation predicate matches only the continue action", () => {
  assert.equal(isTurnCommitContinuation(`  ${TURN_COMMIT_ACTION.CONTINUE.toUpperCase()}  `), true);
  assert.equal(isTurnCommitContinuation(TURN_COMMIT_ACTION.SEND), false);
  assert.equal(isTurnCommitContinuation(""), false);
  assert.equal(isTurnCommitContinuation(null), false);
});
