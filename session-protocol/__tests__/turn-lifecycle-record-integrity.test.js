/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { turnRecord } from "./helpers/turn-record.js";
import test from "node:test";
import assert from "node:assert/strict";
import { assertTurnLifecycleRecordIntegrity, createEmptyTurnLifecycle } from "../src/index.js";

function lifecycle() {
  return {
    ...createEmptyTurnLifecycle(),
    sequence: 3,
    turns: { "turn-1": turnRecord({ sequence: 2 }) },
    replacedTurns: {
      "turn-old": {
        turnScopeId: "turn-old",
        sequence: 3,
        replacementDialogProcessId: "dialog-new",
        replacementTurnScopeId: "turn-new",
        replacementUserMessageUid: "user-new",
        requestHash: "request-hash",
        commandId: "replace-command",
        committedAggregateVersion: 4,
        replacedTurnScopeIds: ["turn-old"],
        committedAt: "2026-07-30T00:00:00.000Z",
      },
    },
  };
}

test("lifecycle integrity accepts explicit empty state and preserves committed coordinates", () => {
  const empty = createEmptyTurnLifecycle();
  assert.equal(assertTurnLifecycleRecordIntegrity(empty), empty);
  const source = lifecycle();
  const before = structuredClone(source);
  assert.equal(assertTurnLifecycleRecordIntegrity(source), source);
  assert.deepEqual(source, before);
});

for (const field of ["turns", "replacedTurns"]) {
  for (const [name, record] of [
    ["null record", null],
    ["array record", []],
    ["missing identity", { sequence: 1 }],
    ["mismatched identity", { turnScopeId: "other", sequence: 1 }],
    ["noncanonical identity", { turnScopeId: " turn-1", sequence: 1 }],
    ["missing sequence", { turnScopeId: "turn-1" }],
    ["string sequence", { turnScopeId: "turn-1", sequence: "1" }],
    ["zero sequence", { turnScopeId: "turn-1", sequence: 0 }],
    ["future sequence", { turnScopeId: "turn-1", sequence: 4 }],
  ]) {
    test(`lifecycle integrity rejects ${field}: ${name} without changing source`, () => {
      const source = lifecycle();
      source[field] = { "turn-1": record };
      const before = structuredClone(source);
      assert.throws(() => assertTurnLifecycleRecordIntegrity(source), {
        code: "TURN_LIFECYCLE_RECORD_INVALID",
      });
      assert.deepEqual(source, before);
    });
  }
}

for (const source of [
  undefined,
  null,
  {},
  { ...lifecycle(), sequence: "3" },
  { ...lifecycle(), sequence: -1 },
]) {
  test(`lifecycle integrity rejects incomplete state ${JSON.stringify(source)}`, () => {
    assert.throws(() => assertTurnLifecycleRecordIntegrity(source), {
      code: "TURN_LIFECYCLE_RECORD_INVALID",
    });
  });
}
