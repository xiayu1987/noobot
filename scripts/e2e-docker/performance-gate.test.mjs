/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluatePerformance } from "./performance-gate.mjs";
import { DEVELOPMENT_THRESHOLDS } from "../lib/development-thresholds.mjs";
import { PERF_SCENARIO } from "../mock-model-service/scenario.mjs";

const baseline = {
  version: 1,
  scenario: PERF_SCENARIO,
  metrics: { totalMs: 1000, acceptedMs: 100 },
};
const samples = () =>
  Array.from({ length: DEVELOPMENT_THRESHOLDS.performance.rounds }, (_, index) => ({
    round: index + 1,
    metrics: { totalMs: 1000, acceptedMs: 100 },
  }));

test("performance gate separates cold start, tolerates one warm outlier, and rejects sustained regression", () => {
  const measured = samples();
  measured[0].metrics.totalMs = 10000;
  measured[1].metrics.acceptedMs = 1000;
  assert.equal(evaluatePerformance(measured, baseline).passed, true);
  for (const sample of measured.slice(2)) sample.metrics.acceptedMs = 1000;
  assert.equal(evaluatePerformance(measured, baseline).passed, false);
  const coldTimeout = samples();
  coldTimeout[0].metrics.totalMs = 1000000;
  assert.match(evaluatePerformance(coldTimeout, baseline).failures.join(), /round 1/);
});

test("performance gate rejects missing samples, invalid measurements, coverage loss, and wrong scenario", () => {
  assert.equal(evaluatePerformance(samples().slice(1), baseline).passed, false);
  for (const value of [NaN, Infinity, -1, undefined]) {
    const measured = samples();
    measured[2].metrics.acceptedMs = value;
    assert.equal(evaluatePerformance(measured, baseline).passed, false);
  }
  assert.equal(evaluatePerformance(samples(), { ...baseline, scenario: "other" }).passed, false);
  assert.equal(evaluatePerformance(samples(), { ...baseline, metrics: {} }).passed, false);
  const missing = samples();
  delete missing[0].metrics.acceptedMs;
  assert.equal(evaluatePerformance(missing, baseline).passed, false);
  const duplicate = samples();
  duplicate[4].round = 4;
  assert.equal(evaluatePerformance(duplicate, baseline).passed, false);
});

test("performance gate catches late-session degradation even when the warm median passes", () => {
  const measured = samples();
  for (const sample of measured.slice(-2)) sample.metrics.totalMs = 1500;
  const result = evaluatePerformance(measured, baseline);
  assert.equal(result.metrics.totalMs.p50, 1000);
  assert.equal(result.metrics.totalMs.earlyP50, 1000);
  assert.equal(result.metrics.totalMs.lateP50, 1500);
  assert.equal(result.passed, false);
  assert.match(result.failures.join(), /late rounds/);
});
