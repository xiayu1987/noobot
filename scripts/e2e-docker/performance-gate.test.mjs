/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluatePerformance,
  evaluatePerformanceCollection,
  evaluateSingleRoundPerformance,
} from "./performance-gate.mjs";
import { calibratePerformance } from "./calibrate-performance.mjs";
import { performanceReportFixture } from "./__tests__/performance-fixture.mjs";
import { PARTITION_CHECKPOINT_JOURNAL_WORK } from "@noobot/session-protocol/partition-journal";

function fixture() {
  const report = performanceReportFixture();
  const baseline = calibratePerformance(
    Array.from({ length: 3 }, () => performanceReportFixture()),
    { sourceReports: ["fixture-a", "fixture-b", "fixture-c"] },
  );
  const evaluate = () =>
    evaluatePerformance(
      report.samples,
      baseline,
      report.stopContinues.map(({ continued }) => continued),
      report.stopContinues,
    );
  return { report, baseline, evaluate };
}

test("single-round gate requires complete coverage and strictly less than 60 seconds", () => {
  const sample = performanceReportFixture().samples[0];
  sample.inputTiming = { clickToVisibleCompletionMs: 1000 };
  const timing = { preparationMs: 58000, totalMs: 59999 };
  const evaluate = (samples = [sample]) => evaluateSingleRoundPerformance(samples, timing);
  assert.equal(evaluate().passed, true);
  assert.equal(evaluate().metrics.singleRoundMs, 59999);
  for (const elapsed of [60000, 60001, undefined, NaN, -1]) {
    timing.totalMs = elapsed;
    assert.equal(evaluate().passed, false);
  }
  timing.totalMs = 59999;
  assert.equal(evaluate([]).passed, false);
  assert.equal(evaluate([sample, sample]).passed, false);
  sample.toolCount--;
  assert.match(evaluate().failures.join(), /tool coverage/);
  sample.toolCount++;
  sample.harness.purposes.pop();
  assert.equal(evaluate().passed, false);
});

test("single-round reports cannot omit preparation or substitute click-only timing", () => {
  const sample = performanceReportFixture().samples[0];
  sample.inputTiming = { clickToVisibleCompletionMs: 1000 };
  for (const timing of [
    undefined,
    {},
    { preparationMs: 59000, totalMs: 60001 },
    { preparationMs: 59000, totalMs: 1000 },
    { preparationMs: -1, totalMs: 1000 },
    { preparationMs: NaN, totalMs: 1000 },
    { totalMs: 1000 },
  ])
    assert.equal(evaluateSingleRoundPerformance([sample], timing).passed, false);
  for (const elapsed of [undefined, NaN, -1]) {
    sample.inputTiming.clickToVisibleCompletionMs = elapsed;
    assert.equal(
      evaluateSingleRoundPerformance([sample], { preparationMs: 1000, totalMs: 3000 }).passed,
      false,
    );
  }
});

test("collection requires complete coverage and enforces growth without a baseline", () => {
  const report = performanceReportFixture();
  const collect = () =>
    evaluatePerformanceCollection(
      report.samples,
      report.stopContinues.map(({ continued }) => continued),
      report.stopContinues,
    );
  assert.equal(collect().passed, true);
  for (const sample of report.samples.slice(16, 19)) sample.metrics.checkpointMs *= 2;
  assert.match(collect().failures.join(), /ordinary.checkpointMs.growth/);
  report.stopContinues.pop();
  assert.match(collect().failures.join(), /incomplete continuations/);
});

test("checkpoint coverage requires actual partition reads, writes and publication", () => {
  for (const name of PARTITION_CHECKPOINT_JOURNAL_WORK) {
    for (const value of [undefined, 0, -1, NaN]) {
      const { report, evaluate } = fixture();
      const work =
        report.stopContinues[0].continued.checkpointSamples[0].storageWork.partitionJournal;
      if (value === undefined) delete work[name];
      else work[name] = value;
      assert.equal(evaluate().passed, false, `${name}: ${value}`);
    }
  }
});

test("checkpoint evidence requires journal durability and rejects legacy counters", () => {
  for (const mutate of [
    (work) => {
      work.partitionJournal.publications = 2;
    },
    (work) => {
      work.partitionJournal.dataSyncs = 5;
    },
    (work) => {
      delete work.partitionJournal;
      work.immutableSegmentWrites = 1;
    },
  ]) {
    const { report, evaluate } = fixture();
    mutate(report.samples[0].checkpointSamples[0].storageWork);
    assert.equal(evaluate().passed, false);
  }
});

test("mixed gate covers twenty turns, both long turns and independently checks each resume", () => {
  const { report, evaluate } = fixture();
  assert.equal(evaluate().passed, true);
  report.stopContinues[1].continued.metrics.pipelineLocalMs = 10000;
  assert.match(evaluate().failures.join(), /continuation 2/);
});

test("long-turn growth cannot hide below an absolute baseline allowance", () => {
  for (const index of [9, 19]) {
    const { report, evaluate } = fixture();
    const points = report.samples[index].checkpointSamples;
    for (const point of points.slice(-Math.floor(points.length / 3))) point.durationMs = 32;
    assert.match(evaluate().failures.join(), new RegExp(`round.${index + 1}.checkpoint`));
  }
});

test("cross-round growth remains visible when the overall median passes", () => {
  const { report, evaluate } = fixture();
  for (const sample of report.samples.slice(16, 19)) sample.metrics.pipelineLocalMs = 1500;
  assert.match(evaluate().failures.join(), /ordinary.pipelineLocalMs.growth/);
});

test("coverage rejects missing tools, capabilities, checkpoints, stops and mismatched baseline", () => {
  for (const mutate of [
    ({ report }) => report.samples.pop(),
    ({ report }) => report.samples[0].toolCount--,
    ({ report }) => report.samples[0].harness.purposes.pop(),
    ({ report }) => (report.samples[0].serverToolEvents[0].data.success = false),
    ({ report }) => delete report.samples[0].checkpointSamples[0].appendMs,
    ({ report }) => report.stopContinues.pop(),
    ({ report }) => (report.samples[0].metrics.pipelineLocalMs = NaN),
    ({ baseline }) => (baseline.plugins = []),
    ({ baseline }) => (baseline.stopMetrics = {}),
  ]) {
    const current = fixture();
    mutate(current);
    assert.equal(current.evaluate().passed, false);
  }
});
