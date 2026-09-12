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
  projectSystemRuntimeTurnProgress,
  applySystemRuntimeTurnProgress,
} from "../src/index.js";

test("projects turn progress counters and summary flags only", () => {
  const progress = projectSystemRuntimeTurnProgress({
    phaseSummaryLoopCount: 7,
    taskCheckLoopCount: -2,
    helpPromptLoopCount: "3",
    toolConsecutiveFailureCount: 1,
    needsPhaseSummary: true,
    phaseSummaryByCharsPrompted: "yes",
    modelLoopRound: 9,
    mainFlowFinalNoToolsTurnActive: true,
  });
  assert.deepEqual(progress, {
    phaseSummaryLoopCount: 7,
    taskCheckLoopCount: 0,
    helpPromptLoopCount: 3,
    toolConsecutiveFailureCount: 1,
    needsPhaseSummary: true,
    phaseSummaryByCharsPrompted: false,
  });
});

test("projects an all-zero turn progress for missing sources", () => {
  assert.deepEqual(projectSystemRuntimeTurnProgress(null), {
    phaseSummaryLoopCount: 0,
    taskCheckLoopCount: 0,
    helpPromptLoopCount: 0,
    toolConsecutiveFailureCount: 0,
    needsPhaseSummary: false,
    phaseSummaryByCharsPrompted: false,
  });
});

test("applies restored turn progress onto the system runtime in place", () => {
  const systemRuntime = { phaseSummaryLoopCount: 0, modelLoopRound: 4 };
  const applied = applySystemRuntimeTurnProgress(systemRuntime, {
    phaseSummaryLoopCount: 5,
    needsPhaseSummary: true,
  });
  assert.equal(systemRuntime.phaseSummaryLoopCount, 5);
  assert.equal(systemRuntime.needsPhaseSummary, true);
  assert.equal(systemRuntime.taskCheckLoopCount, 0);
  assert.equal(systemRuntime.modelLoopRound, 4);
  assert.equal(applied.phaseSummaryLoopCount, 5);
  assert.equal(applySystemRuntimeTurnProgress(null, {}), null);
});

test("restored turn progress survives the per-turn counter normalization", () => {
  const systemRuntime = {};
  applySystemRuntimeTurnProgress(systemRuntime, {
    phaseSummaryLoopCount: 6,
    needsPhaseSummary: true,
    phaseSummaryByCharsPrompted: true,
  });
  normalizeSystemRuntimeCounters(systemRuntime, "next message");
  assert.equal(systemRuntime.phaseSummaryLoopCount, 6);
  assert.equal(systemRuntime.needsPhaseSummary, true);
  assert.equal(systemRuntime.phaseSummaryByCharsPrompted, true);
  assert.equal(systemRuntime.modelLoopRound, 0);
});

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
