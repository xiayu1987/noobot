/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  createTurnTerminalResolution,
  validateTurnTerminalResolution,
} from "@noobot/session-protocol";

const input = {
  commandId: "command-1",
  sessionId: "session-1",
  turnScopeId: "turn-1",
  reason: "turn_not_found",
  generatedAt: "2026-11-01T00:00:00.000Z",
};

test("terminal factory declares optional defaults and returns a valid response without changing input", () => {
  const source = structuredClone(input);
  const result = createTurnTerminalResolution(source);
  assert.deepEqual(validateTurnTerminalResolution(result), { valid: true, errors: [] });
  assert.equal(result.resolved, false);
  assert.equal(result.retryable, false);
  assert.equal(result.retryAfterMs, 0);
  assert.equal(result.turn, null);
  assert.deepEqual(source, input);
});

test("terminal factory rejects invalid identities and flags instead of cleaning or coercing them", () => {
  for (const field of ["commandId", "sessionId", "turnScopeId", "generatedAt"]) {
    for (const value of ["", " padded ", 42, null]) {
      assert.throws(() => createTurnTerminalResolution({ ...input, [field]: value }), TypeError);
    }
  }
  for (const change of [
    { resolved: "false" },
    { retryable: "false" },
    { reason: " pending " },
    { resolved: true, aggregateVersion: "1", turn: null },
    { reason: "" },
  ]) {
    const source = { ...input, ...change };
    const before = structuredClone(source);
    assert.throws(() => createTurnTerminalResolution(source), TypeError);
    assert.deepEqual(source, before);
  }
});
