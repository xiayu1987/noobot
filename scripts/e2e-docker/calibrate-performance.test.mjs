/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { calibratePerformance } from "./calibrate-performance.mjs";
import { performanceReportFixture } from "./__tests__/performance-fixture.mjs";

const reports = () => Array.from({ length: 3 }, () => performanceReportFixture());

test("calibration separates cold, ordinary and long samples and preserves provenance", () => {
  const inputs = reports();
  inputs[0].samples[0].metrics.pipelineLocalMs = 10000;
  const candidate = calibratePerformance(inputs, { sourceReports: ["a.json", "b.json", "c.json"] });
  assert.equal(candidate.metrics.ordinary.pipelineLocalMs, 1000);
  assert.equal(candidate.metrics.long.pipelineLocalMs, 10000);
  assert.deepEqual(candidate.calibration.coldPipelineLocalMs, [10000, 1000, 1000]);
  assert.equal(candidate.calibration.replayCount, 3);
  assert.deepEqual(candidate.calibration.sourceReports, ["a.json", "b.json", "c.json"]);
});

test("calibration rejects partial replay, failed tools and missing Harness summaries", () => {
  for (const mutate of [
    (report) => report.samples.pop(),
    (report) => (report.samples[0].serverToolEvents[0].data.success = false),
    (report) => (report.samples[3].summaryCount = 0),
    (report) => (report.harness = {}),
  ]) {
    const inputs = reports();
    mutate(inputs[2]);
    assert.throws(() => calibratePerformance(inputs));
  }
});

test("calibration cannot absorb growth or absolute timeouts", () => {
  const growing = reports();
  for (const sample of growing[2].samples.slice(16, 19)) sample.metrics.pipelineLocalMs = 1500;
  assert.throws(() => calibratePerformance(growing), /cross-round limits/);
  const slow = reports();
  slow[2].samples[0].metrics.pipelineLocalMs = 1000000;
  assert.throws(() => calibratePerformance(slow), /round 1/);
});

test("calibration rejects insufficient replays and inconsistent metric coverage", () => {
  for (const input of [performanceReportFixture(), reports().slice(0, 2)])
    assert.throws(() => calibratePerformance(input), /at least three/);
  const inputs = reports();
  inputs[2].samples[3].metrics.extraMs = 1;
  assert.throws(() => calibratePerformance(inputs), /metric coverage mismatch/);
});
