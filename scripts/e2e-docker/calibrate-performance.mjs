/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { DEVELOPMENT_THRESHOLDS } from "../lib/development-thresholds.mjs";
import {
  PERF_ALL_TOOLS,
  PERF_REPETITIONS,
  PERF_SCENARIO,
} from "../mock-model-service/scenario.mjs";
import { evaluatePerformance, median } from "./performance-gate.mjs";

export function calibratePerformance(report, metadata) {
  assert.equal(report.version, 1, "unsupported performance report");
  assert.equal(report.scenario, PERF_SCENARIO, "scenario mismatch");
  assert.equal(
    report.samples.length,
    DEVELOPMENT_THRESHOLDS.performance.rounds,
    "incomplete replay",
  );
  const toolCount = PERF_ALL_TOOLS.length * PERF_REPETITIONS;
  for (const sample of report.samples) {
    assert.equal(sample.toolCount, toolCount, "incomplete tool coverage");
    assert.equal(sample.modelRequestCount, toolCount + 1, "unexpected main-model count");
    assert.equal(sample.summaryCount, PERF_REPETITIONS, "missing phase summaries");
    const results = sample.serverToolEvents.filter((event) => event.event === "tool_call_end");
    assert.equal(results.length, toolCount, "missing tool results");
    assert.ok(
      results.every((event) => event.data.success === true),
      "tool failure in calibration",
    );
    for (const name of PERF_ALL_TOOLS) {
      assert.equal(sample.toolSamples[name]?.length, PERF_REPETITIONS, `${name}: missing samples`);
      assert.equal(results.filter((event) => event.data.tool === name).length, PERF_REPETITIONS);
    }
  }
  const baseline = {
    version: 1,
    scenario: PERF_SCENARIO,
    calibration: {
      ...metadata,
      method: `Measured warm median of turns 2-${DEVELOPMENT_THRESHOLDS.performance.rounds}; ${PERF_ALL_TOOLS.length} tools x ${PERF_REPETITIONS} calls and ${PERF_REPETITIONS} phase summaries per turn`,
      coldTotalMs: report.samples[0].metrics.totalMs,
      warmTotalMs: report.samples.slice(1).map((sample) => sample.metrics.totalMs),
    },
    metrics: Object.fromEntries(
      Object.keys(report.samples[0].metrics).map((name) => [
        name,
        median(report.samples.slice(1).map((sample) => sample.metrics[name])),
      ]),
    ),
  };
  const gate = evaluatePerformance(report.samples, baseline);
  assert.equal(
    gate.passed,
    true,
    `Calibration violates absolute or cross-round limits: ${gate.failures.join("; ")}`,
  );
  return baseline;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output] = process.argv.slice(2);
  assert.ok(
    input && output,
    "usage: node scripts/e2e-docker/calibrate-performance.mjs <report.json> <candidate.json>",
  );
  const baseline = calibratePerformance(JSON.parse(await readFile(input, "utf8")), {
    date: new Date().toISOString(),
    runtime: `${process.platform} ${process.arch}, Node ${process.versions.node}, Chromium in e2e Docker`,
    sourceReport: input,
  });
  await writeFile(output, `${JSON.stringify(baseline, null, 2)}\n`, { flag: "wx" });
  console.log(
    `Candidate written to ${output}; review it and run an independent replay before accepting.`,
  );
}
