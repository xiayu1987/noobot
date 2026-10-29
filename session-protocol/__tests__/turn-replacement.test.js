/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  assertTurnReplacementCommit,
  createTurnReplacementCommit,
  validateTurnReplacementCommit,
} from "../src/lifecycle/turn-replacement.js";

function input(overrides = {}) {
  return {
    commandId: "resend-1",
    sessionId: "session-1",
    committedAggregateVersion: 4,
    replacedTurnScopeIds: ["turn-old"],
    replacementDialogProcessId: "dialog-new",
    replacementTurnScopeId: "turn-new",
    replacementUserMessageUid: "user-new",
    requestHash: "request-hash-1",
    committedAt: "2026-07-31T00:00:00.000Z",
    ...overrides,
  };
}

test("turn replacement commit binds one replacement user to one committed session version", () => {
  const commit = createTurnReplacementCommit(input());
  assert.equal(validateTurnReplacementCommit(commit).valid, true);
  assert.equal(assertTurnReplacementCommit(commit), commit);
  assert.equal(commit.committedAggregateVersion, 4);
  assert.equal(Object.isFrozen(commit.replacedTurnScopeIds), true);
});

test("turn replacement commit requires every field and never fills a default", () => {
  for (const field of Object.keys(input())) {
    const { [field]: _omitted, ...rest } = input();
    assert.throws(
      () => createTurnReplacementCommit(rest),
      /invalid turn replacement commit/,
      field,
    );
  }
});

test("turn replacement commit rejects non-canonical values instead of coercing them", () => {
  const invalid = [
    { committedAggregateVersion: "4" },
    { committedAggregateVersion: 0 },
    { commandId: " resend-1" },
    { replacedTurnScopeIds: [] },
    { replacedTurnScopeIds: ["turn-old", "turn-old"] },
    { replacedTurnScopeIds: ["turn-old", ""] },
    { replacementTurnScopeId: "turn-old" },
  ];
  for (const overrides of invalid) {
    assert.throws(
      () => createTurnReplacementCommit(input(overrides)),
      /invalid turn replacement commit/,
    );
  }
});

test("turn replacement commit validation rejects a non-object and a foreign protocol version", () => {
  assert.deepEqual(validateTurnReplacementCommit(null).errors, ["commit_not_object"]);
  assert.deepEqual(validateTurnReplacementCommit(undefined).errors, ["commit_not_object"]);
  const commit = createTurnReplacementCommit(input());
  assert.ok(
    validateTurnReplacementCommit({ ...commit, protocolVersion: 2 }).errors.includes(
      "unsupported_protocol_version",
    ),
  );
  assert.ok(
    validateTurnReplacementCommit({ ...commit, eventType: "turn.other" }).errors.includes(
      "invalid_event_type",
    ),
  );
});
