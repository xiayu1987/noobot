/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  SYSTEM_RUNTIME_COUNTER_KEYS,
  normalizeSystemRuntimeCounterValue,
  normalizeSystemRuntimeCounters,
} from "../src/index.js";

test("ignores non-object system runtime", () => {
  assert.equal(normalizeSystemRuntimeCounters(null, "hi"), undefined);
  assert.equal(normalizeSystemRuntimeCounters(undefined, "hi"), undefined);
});

test("normalizes counter values to non-negative numbers", () => {
  assert.equal(normalizeSystemRuntimeCounterValue(3), 3);
  assert.equal(normalizeSystemRuntimeCounterValue(-1), 0);
  assert.equal(normalizeSystemRuntimeCounterValue("abc"), 0);
  assert.equal(normalizeSystemRuntimeCounterValue(undefined), 0);
});

test("mutates the given system runtime in place", () => {
  const systemRuntime = {
    phaseSummaryLoopCount: "2",
    taskCheckLoopCount: -5,
    helpPromptLoopCount: undefined,
    toolConsecutiveFailureCount: 4,
    modelLoopRound: 9,
    needsPhaseSummary: "yes",
    phaseSummaryByCharsPrompted: true,
    mainFlowFinalNoToolsTurnActive: true,
  };
  const result = normalizeSystemRuntimeCounters(systemRuntime, "  hello  ");
  assert.equal(result, undefined);
  assert.equal(systemRuntime.phaseSummaryLoopCount, 2);
  assert.equal(systemRuntime.taskCheckLoopCount, 0);
  assert.equal(systemRuntime.helpPromptLoopCount, 0);
  assert.equal(systemRuntime.toolConsecutiveFailureCount, 4);
  assert.equal(systemRuntime.modelLoopRound, 0);
  assert.equal(systemRuntime.needsPhaseSummary, false);
  assert.equal(systemRuntime.phaseSummaryByCharsPrompted, true);
  assert.equal(systemRuntime.mainFlowFinalNoToolsTurnActive, false);
  assert.equal(systemRuntime.currentTurnUserMessage, "hello");
});

test("exposes a frozen counter key list", () => {
  assert.ok(Object.isFrozen(SYSTEM_RUNTIME_COUNTER_KEYS));
  assert.deepEqual(SYSTEM_RUNTIME_COUNTER_KEYS, [
    "phaseSummaryLoopCount",
    "taskCheckLoopCount",
    "helpPromptLoopCount",
    "toolConsecutiveFailureCount",
  ]);
});

test("defaults the current turn user message to an empty string", () => {
  const systemRuntime = {};
  normalizeSystemRuntimeCounters(systemRuntime);
  assert.equal(systemRuntime.currentTurnUserMessage, "");
});
