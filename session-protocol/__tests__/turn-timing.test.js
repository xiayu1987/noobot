/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mergeTurnTimingRecord, normalizeTurnTimingRecord } from "../src/index.js";

const FINISHED_AT = "2026-10-01T00:00:09.000Z";
const base = { turnScopeId: "turn-1", dialogProcessId: "dialog-1" };

test("turn timing record normalizes protocol fact fields", () => {
  assert.deepEqual(
    normalizeTurnTimingRecord({
      ...base,
      thinkingFinishedAt: FINISHED_AT,
      modelLoopRound: 2,
    }),
    { ...base, thinkingFinishedAt: FINISHED_AT, modelLoopRound: 2 },
  );
});

test("turn timing record rejects missing scope, empty facts and invalid round", () => {
  for (const record of [
    { thinkingFinishedAt: FINISHED_AT },
    { turnScopeId: "turn-1", thinkingFinishedAt: FINISHED_AT },
    { ...base },
    { ...base, modelLoopRound: -1 },
    { ...base, modelLoopRound: "2" },
    { ...base, thinkingFinishedAt: FINISHED_AT, thinkingStartedAt: "2026-10-01T00:00:00.000Z" },
    { ...base, thinkingFinishedAt: FINISHED_AT, startedAt: "2026-10-01T00:00:00.000Z" },
  ]) {
    assert.throws(() => normalizeTurnTimingRecord(record), { code: "SESSION_TURN_TIMING_INVALID" });
  }
});

test("turn timing merge is first-write-wins and idempotent for equal facts", () => {
  const first = { ...base, thinkingFinishedAt: FINISHED_AT };
  assert.deepEqual(mergeTurnTimingRecord(first, { ...first }), first);
  assert.deepEqual(mergeTurnTimingRecord(first, { ...base, modelLoopRound: 3 }), {
    ...first,
    modelLoopRound: 3,
  });
});

test("turn timing merge rejects conflicting facts", () => {
  const first = { ...base, thinkingFinishedAt: FINISHED_AT, modelLoopRound: 2 };
  for (const incoming of [
    { ...base, thinkingFinishedAt: "2026-10-01T00:00:10.000Z" },
    { ...base, modelLoopRound: 3 },
    { ...base, dialogProcessId: "dialog-2", modelLoopRound: 2 },
  ]) {
    assert.throws(() => mergeTurnTimingRecord(first, incoming), {
      code: "SESSION_TURN_TIMING_CONFLICT",
    });
  }
});
