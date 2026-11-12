/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DEVELOPMENT_THRESHOLDS } from "../lib/development-thresholds.mjs";
import { PERF_SCENARIO } from "../mock-model-service/scenario.mjs";

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function evaluatePerformance(samples, baseline) {
  const policy = DEVELOPMENT_THRESHOLDS.performance;
  const failures = [];
  const metrics = {};
  if (
    baseline?.version !== 1 ||
    baseline.scenario !== PERF_SCENARIO ||
    !baseline.metrics ||
    samples.length !== policy.rounds
  ) {
    return {
      passed: false,
      failures: [`Expected baseline v1 for ${PERF_SCENARIO} and exactly ${policy.rounds} rounds`],
      metrics,
    };
  }
  const names = Object.keys(baseline.metrics).sort();
  if (
    !names.includes("totalMs") ||
    samples.some(
      (sample, index) =>
        sample.round !== index + 1 ||
        JSON.stringify(Object.keys(sample.metrics || {}).sort()) !== JSON.stringify(names),
    )
  ) {
    return {
      passed: false,
      failures: ["Missing metrics, metric coverage mismatch, or invalid round sequence"],
      metrics,
    };
  }
  for (const [name, reference] of Object.entries(baseline.metrics)) {
    const values = samples.map((sample) => sample.metrics[name]);
    if (
      !Number.isFinite(reference) ||
      reference <= 0 ||
      values.some((value) => !Number.isFinite(value) || value < 0)
    ) {
      failures.push(`${name}: invalid or missing measurement`);
      continue;
    }
    const p50 = median(values.slice(1));
    const earlyP50 = median(values.slice(1, 1 + policy.growthWindowRounds));
    const lateP50 = median(values.slice(-policy.growthWindowRounds));
    const growthLimit = earlyP50 * (1 + policy.roundGrowthTolerance) + policy.absoluteToleranceMs;
    const limit = reference * (1 + policy.relativeTolerance) + policy.absoluteToleranceMs;
    metrics[name] = {
      cold: values[0],
      warm: values.slice(1),
      p50,
      max: Math.max(...values),
      baseline: reference,
      limit,
      earlyP50,
      lateP50,
      growthRatio: earlyP50 > 0 ? lateP50 / earlyP50 : null,
      growthLimit,
    };
    if (p50 > limit) failures.push(`${name}: warm p50 ${p50.toFixed(1)}ms > ${limit.toFixed(1)}ms`);
    if (lateP50 > growthLimit)
      failures.push(
        `${name}: late rounds ${lateP50.toFixed(1)}ms > early-round growth limit ${growthLimit.toFixed(1)}ms`,
      );
  }
  samples.forEach((sample, index) => {
    const limit = index === 0 ? policy.coldTurnMaxMs : policy.warmTurnMaxMs;
    if (!Number.isFinite(sample.metrics.totalMs) || sample.metrics.totalMs > limit)
      failures.push(`round ${index + 1}: total exceeds ${limit}ms`);
  });
  return { passed: failures.length === 0, failures, metrics };
}
