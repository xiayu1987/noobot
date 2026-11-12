/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { calibratePerformance } from "./calibrate-performance.mjs";
import { DEVELOPMENT_THRESHOLDS } from "../lib/development-thresholds.mjs";
import {
  PERF_ALL_TOOLS,
  PERF_REPETITIONS,
  PERF_SCENARIO,
} from "../mock-model-service/scenario.mjs";

function report() {
  return {
    version: 1,
    scenario: PERF_SCENARIO,
    samples: Array.from({ length: DEVELOPMENT_THRESHOLDS.performance.rounds }, (_, index) => ({
      round: index + 1,
      toolCount: PERF_ALL_TOOLS.length * PERF_REPETITIONS,
      modelRequestCount: PERF_ALL_TOOLS.length * PERF_REPETITIONS + 1,
      summaryCount: PERF_REPETITIONS,
      metrics: { totalMs: 1000 + index },
      toolSamples: Object.fromEntries(
        PERF_ALL_TOOLS.map((name) => [name, Array(PERF_REPETITIONS).fill(10)]),
      ),
      serverToolEvents: PERF_ALL_TOOLS.flatMap((tool) =>
        Array.from({ length: PERF_REPETITIONS }, () => ({
          event: "tool_call_end",
          data: { tool, success: true },
        })),
      ),
    })),
  };
}

test("calibration separates the cold sample and preserves provenance", () => {
  const measured = report();
  measured.samples[0].metrics.totalMs = 10000;
  const candidate = calibratePerformance(measured, { sourceReport: "audit.json" });
  assert.equal(candidate.metrics.totalMs, 1003);
  assert.equal(candidate.calibration.coldTotalMs, 10000);
  assert.equal(candidate.calibration.sourceReport, "audit.json");
});

test("calibration refuses partial, failed, and incomplete-summary replays", () => {
  const incomplete = report();
  incomplete.samples.pop();
  assert.throws(() => calibratePerformance(incomplete), /incomplete replay/);
  const failed = report();
  failed.samples[0].serverToolEvents[0].data.success = false;
  assert.throws(() => calibratePerformance(failed), /tool failure/);
  const missingSummary = report();
  missingSummary.samples[3].summaryCount = PERF_REPETITIONS - 1;
  assert.throws(() => calibratePerformance(missingSummary), /phase summaries/);
});

test("calibration cannot absorb late-session degradation or absolute timeouts", () => {
  const growing = report();
  for (const sample of growing.samples.slice(-2)) sample.metrics.totalMs = 1500;
  assert.throws(() => calibratePerformance(growing), /cross-round limits/);
  const slow = report();
  slow.samples[0].metrics.totalMs = 1000000;
  assert.throws(() => calibratePerformance(slow), /round 1/);
});
