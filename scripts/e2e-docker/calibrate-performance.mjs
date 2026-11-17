/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  PERF_SCENARIO,
  PERF_ROUNDS,
  PERF_PLUGINS,
  PERF_HARNESS,
} from "../mock-model-service/performance-contract.mjs";
import { assertPerformanceCoverage, evaluatePerformance, median } from "./performance-gate.mjs";

function validateReport(report) {
  assert.equal(report.version, 2, "unsupported performance report");
  assert.equal(report.scenario, PERF_SCENARIO, "scenario mismatch");
  assert.deepEqual(report.plan, PERF_ROUNDS, "scenario plan mismatch");
  assert.deepEqual(report.plugins, PERF_PLUGINS, "plugin configuration mismatch");
  assert.deepEqual(report.harness, PERF_HARNESS, "Harness configuration mismatch");
  const continuations = report.stopContinues.map(({ continued }) => continued);
  assertPerformanceCoverage(report.samples, continuations, report.stopContinues);
}

export function calibratePerformance(reports, metadata) {
  assert.ok(
    Array.isArray(reports) && reports.length >= 3,
    "Calibration requires at least three complete replays",
  );
  for (const report of reports) validateReport(report);
  const samples = reports.flatMap((report) => report.samples);
  const stops = reports.flatMap((report) => report.stopContinues);
  const metricNames = Object.keys(samples[0].metrics).sort();
  for (const sample of [...samples, ...stops.map(({ continued }) => continued)])
    assert.deepEqual(
      Object.keys(sample.metrics).sort(),
      metricNames,
      "metric coverage mismatch across replays",
    );
  const baseline = {
    version: 2,
    scenario: PERF_SCENARIO,
    plan: PERF_ROUNDS,
    plugins: PERF_PLUGINS,
    harness: PERF_HARNESS,
    calibration: {
      ...metadata,
      method:
        "Separate ordinary/long medians across complete twenty-turn Harness replays; independent replay required",
      replayCount: reports.length,
      coldPipelineLocalMs: reports.map((report) => report.samples[0].metrics.pipelineLocalMs),
      warmPipelineLocalMs: reports.map((report) =>
        report.samples.slice(1).map((sample) => sample.metrics.pipelineLocalMs),
      ),
    },
    metrics: Object.fromEntries(
      ["ordinary", "long"].map((kind) => {
        const group = samples.filter((sample) => sample.kind === kind && sample.round !== 1);
        return [
          kind,
          Object.fromEntries(
            Object.keys(group[0].metrics).map((name) => [
              name,
              median(group.map((sample) => sample.metrics[name])),
            ]),
          ),
        ];
      }),
    ),
    stopMetrics: Object.fromEntries(
      ["clickToCommandMs", "clickToCompletedMs", "clickToUiReadyMs"].map((name) => [
        name,
        median(stops.map((sample) => sample.stopTiming[name])),
      ]),
    ),
  };
  for (const [index, report] of reports.entries()) {
    const gate = evaluatePerformance(
      report.samples,
      baseline,
      report.stopContinues.map(({ continued }) => continued),
      report.stopContinues,
    );
    assert.equal(
      gate.passed,
      true,
      `Calibration replay ${index + 1} violates absolute or cross-round limits: ${gate.failures.join("; ")}`,
    );
  }
  return baseline;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [output, ...inputs] = process.argv.slice(2);
  assert.ok(
    output && inputs.length >= 3 && new Set(inputs).size === inputs.length,
    "usage: node scripts/e2e-docker/calibrate-performance.mjs <candidate.json> <report1.json> <report2.json> <report3.json> [...]",
  );
  const reports = await Promise.all(
    inputs.map(async (input) => JSON.parse(await readFile(input, "utf8"))),
  );
  const baseline = calibratePerformance(reports, {
    date: new Date().toISOString(),
    runtime: `${process.platform} ${process.arch}, Node ${process.versions.node}, Chromium in e2e Docker`,
    sourceReports: inputs,
  });
  await writeFile(output, `${JSON.stringify(baseline, null, 2)}\n`, { flag: "wx" });
  console.log(
    `Candidate written to ${output}; review it and run an independent replay before accepting.`,
  );
}
