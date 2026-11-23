/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { isPlainObject } from "@noobot/shared/value";
import { DEVELOPMENT_THRESHOLDS } from "../lib/development-thresholds.mjs";
import { PARTITION_CHECKPOINT_JOURNAL_WORK } from "@noobot/session-protocol/partition-journal";
import {
  PERF_ROUNDS,
  PERF_SCENARIO,
  PERF_PLUGINS,
  PERF_HARNESS,
  PERF_STOP_CONTINUE_CYCLES,
  performanceRound,
} from "../mock-model-service/performance-contract.mjs";
import { PERF_ALL_TOOLS } from "../mock-model-service/scenario.mjs";
import { assertPerformanceHarness } from "./performance-harness.mjs";

export function median(values) {
  assert.ok(values.length > 0, "Missing performance samples");
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function assertCheckpoint(point) {
  for (const name of ["durationMs", "preparationMs", "appendMs", "verificationMs", "queueWaitMs"])
    assert.ok(Number.isFinite(point[name]) && point[name] >= 0, `invalid checkpoint ${name}`);
  const work = point.storageWork?.partitionJournal;
  assert.ok(isPlainObject(work), "missing partition journal work");
  assert.deepEqual(Object.keys(work).sort(), [...PARTITION_CHECKPOINT_JOURNAL_WORK].sort());
  for (const name of PARTITION_CHECKPOINT_JOURNAL_WORK)
    assert.ok(Number.isSafeInteger(work[name]) && work[name] > 0, `invalid journal work: ${name}`);
  assert.ok(work.dataSyncs >= work.publications, "published journal data must be synchronized");
  assert.ok(work.partitionOpens >= work.dataSyncs, "journal syncs must correspond to opened files");
}

function assertPerformanceSample(sample, plan) {
  assert.equal(sample.round, plan.round, "invalid round order");
  assert.equal(sample.kind, plan.kind, "invalid round kind");
  assert.equal(sample.repetitions, plan.repetitions, "invalid repetitions");
  const toolCount = PERF_ALL_TOOLS.length * plan.repetitions;
  assert.equal(sample.toolCount, toolCount, "incomplete tool coverage");
  assert.ok(sample.modelRequestCount >= toolCount + 1, "missing main-model requests");
  assert.ok(sample.summaryCount > 0, "missing Harness summaries");
  assertPerformanceHarness(sample.harness);
  const results = sample.serverToolEvents.filter((event) => event.event === "tool_call_end");
  assert.equal(results.length, toolCount, "missing tool results");
  assert.ok(
    results.every((event) => event.data.success === true),
    "tool failure",
  );
  for (const name of PERF_ALL_TOOLS) {
    assert.equal(sample.toolSamples[name]?.length, plan.repetitions, `${name}: missing samples`);
    assert.equal(results.filter((event) => event.data.tool === name).length, plan.repetitions);
  }
  assert.ok(sample.checkpointSamples.length >= toolCount * 3 + 1, "missing checkpoints");
  sample.checkpointSamples.forEach(assertCheckpoint);
  for (const [name, value] of Object.entries(sample.metrics))
    assert.ok(Number.isFinite(value) && value >= 0, `invalid metric: ${name}`);
  assert.ok(Number.isFinite(sample.metrics.pipelineLocalMs), "missing local pipeline timing");
}

export function evaluateSingleRoundPerformance(samples, timing) {
  const failures = [];
  const metrics = {};
  try {
    assert.equal(samples.length, 1, "single-round gate requires exactly one round");
    const sample = samples[0];
    assertPerformanceSample(sample, performanceRound(1));
    const elapsed = sample.inputTiming?.clickToVisibleCompletionMs;
    assert.ok(Number.isFinite(elapsed) && elapsed >= 0, "missing single-round elapsed time");
    for (const name of ["preparationMs", "totalMs"])
      assert.ok(
        Number.isFinite(timing?.[name]) && timing[name] >= 0,
        `invalid single-round ${name}`,
      );
    assert.ok(
      timing.totalMs >= timing.preparationMs + elapsed,
      "single-round total must include preparation and visible completion",
    );
    metrics.clickToVisibleCompletionMs = elapsed;
    metrics.preparationMs = timing.preparationMs;
    metrics.singleRoundMs = timing.totalMs;
    assert.ok(
      timing.totalMs < DEVELOPMENT_THRESHOLDS.performance.singleRoundMaxMs,
      "single round must finish within 60 seconds",
    );
  } catch (error) {
    failures.push(error.message);
  }
  return { passed: failures.length === 0, failures, metrics };
}

export function assertPerformanceCoverage(samples, continuations, stops) {
  assert.equal(samples.length, PERF_ROUNDS.length, "incomplete replay");
  assert.equal(continuations.length, PERF_STOP_CONTINUE_CYCLES, "incomplete continuations");
  assert.equal(stops.length, PERF_STOP_CONTINUE_CYCLES, "incomplete stop samples");
  for (const [index, sample] of [...samples, ...continuations].entries())
    assertPerformanceSample(sample, performanceRound(index + 1));
  for (const [index, sample] of stops.entries()) {
    assert.equal(sample.cycle, index + 1, "invalid stop cycle");
    for (const name of ["clickToCommandMs", "clickToCompletedMs", "clickToUiReadyMs"])
      assert.ok(
        Number.isFinite(sample.stopTiming[name]) && sample.stopTiming[name] >= 0,
        `invalid stop ${name}`,
      );
  }
}

function compareWindows(name, early, late, { failures, metrics }) {
  const policy = DEVELOPMENT_THRESHOLDS.performance;
  const limit = early * (1 + policy.roundGrowthTolerance);
  metrics[name] = { early, late, limit, ratio: early > 0 ? late / early : null };
  if (late > limit) failures.push(`${name}: late-window growth exceeds limit`);
}

function compareGroupGrowth(kind, samples, result) {
  const group = samples.filter((sample) => sample.kind === kind && sample.round !== 1);
  const window = kind === "long" ? 1 : DEVELOPMENT_THRESHOLDS.performance.growthWindowRounds;
  for (const name of Object.keys(group[0].metrics))
    compareWindows(
      `${kind}.${name}.growth`,
      median(group.slice(0, window).map((sample) => sample.metrics[name])),
      median(group.slice(-window).map((sample) => sample.metrics[name])),
      result,
    );
}

function compareAbsolute(samples, failures) {
  const policy = DEVELOPMENT_THRESHOLDS.performance;
  for (const sample of samples) {
    const limit =
      sample.round === 1 || sample.kind === "long" ? policy.coldTurnMaxMs : policy.warmTurnMaxMs;
    if (sample.metrics.pipelineLocalMs > limit)
      failures.push(`round ${sample.round}: local pipeline exceeds absolute limit`);
  }
}

export function evaluatePerformanceCollection(samples, continuations, stops) {
  const failures = [];
  const metrics = {};
  try {
    assertPerformanceCoverage(samples, continuations, stops);
    for (const kind of ["ordinary", "long"])
      compareGroupGrowth(kind, samples, { failures, metrics });
    for (const sample of samples.filter(({ kind }) => kind === "long")) {
      const points = sample.checkpointSamples;
      const window = Math.floor(points.length / 3);
      const mean = (values) =>
        values.reduce((sum, point) => sum + point.durationMs, 0) / values.length;
      compareWindows(
        `round.${sample.round}.checkpoint`,
        mean(points.slice(0, window)),
        mean(points.slice(-window)),
        { failures, metrics },
      );
    }
    compareAbsolute([...samples, ...continuations], failures);
  } catch (error) {
    failures.push(error.message);
  }
  return { mode: "collect", passed: failures.length === 0, failures, metrics };
}

function compareBaselineGroup(kind, samples, baseline, { metrics, failures }) {
  const policy = DEVELOPMENT_THRESHOLDS.performance;
  const group = samples.filter((sample) => sample.kind === kind && sample.round !== 1);
  const references = baseline.metrics[kind];
  assert.ok(references && Object.hasOwn(references, "pipelineLocalMs"), `missing ${kind} baseline`);
  const names = Object.keys(references).sort();
  for (const sample of group)
    assert.deepEqual(Object.keys(sample.metrics).sort(), names, "metric coverage mismatch");
  for (const name of names) {
    const reference = references[name];
    assert.ok(Number.isFinite(reference) && reference >= 0, `invalid baseline ${kind}.${name}`);
    const value = median(group.map((sample) => sample.metrics[name]));
    const limit = reference * (1 + policy.relativeTolerance) + policy.absoluteToleranceMs;
    metrics[`${kind}.${name}`] = { value, reference, limit };
    if (value > limit) failures.push(`${kind}.${name}: baseline limit exceeded`);
  }
}

function compareContinuation(sample, references, index, { metrics, failures }) {
  const policy = DEVELOPMENT_THRESHOLDS.performance;
  for (const [name, value] of Object.entries(sample.metrics)) {
    const reference = references[name];
    assert.ok(Number.isFinite(reference), `missing continuation reference: ${name}`);
    const limit = reference * (1 + policy.relativeTolerance) + policy.absoluteToleranceMs;
    metrics[`continuation.${index + 1}.${name}`] = { value, limit };
    if (value > limit) failures.push(`continuation ${index + 1}: ${name} exceeds limit`);
  }
}

function compareStop(sample, references, index, { metrics, failures }) {
  const policy = DEVELOPMENT_THRESHOLDS.performance;
  for (const [name, reference] of Object.entries(references)) {
    const value = sample.stopTiming[name];
    const limit = reference * (1 + policy.relativeTolerance) + policy.absoluteToleranceMs;
    metrics[`stop.${index + 1}.${name}`] = { value, limit };
    if (!Number.isFinite(value) || value > limit)
      failures.push(`stop ${index + 1}: ${name} exceeds limit`);
  }
}

export function evaluatePerformance(samples, baseline, continuations, stops) {
  const failures = [];
  const metrics = {};
  try {
    const collection = evaluatePerformanceCollection(samples, continuations, stops);
    failures.push(...collection.failures);
    Object.assign(metrics, collection.metrics);
    if (!collection.passed) return { passed: false, failures, metrics };
    assert.equal(baseline?.version, 2, "Expected mixed-session baseline v2");
    assert.equal(baseline.scenario, PERF_SCENARIO, "baseline scenario mismatch");
    assert.deepEqual(baseline.plan, PERF_ROUNDS, "baseline plan mismatch");
    assert.deepEqual(baseline.plugins, PERF_PLUGINS, "baseline plugins mismatch");
    assert.deepEqual(baseline.harness, PERF_HARNESS, "baseline Harness mismatch");
    assert.deepEqual(
      Object.keys(baseline.stopMetrics).sort(),
      ["clickToCommandMs", "clickToCompletedMs", "clickToUiReadyMs"],
      "stop metric coverage mismatch",
    );
    for (const kind of ["ordinary", "long"]) {
      compareBaselineGroup(kind, samples, baseline, { metrics, failures });
    }
    for (const [index, sample] of continuations.entries()) {
      compareContinuation(sample, baseline.metrics.ordinary, index, { metrics, failures });
      compareStop(stops[index], baseline.stopMetrics, index, { metrics, failures });
    }
  } catch (error) {
    failures.push(error.message);
  }
  return { passed: failures.length === 0, failures, metrics };
}
