/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { summarizeProcessingTiming } from "../processing-timing.js";
import { monotonicTiming, MONOTONIC_CLOCK_ID } from "../monotonic-clock-node.js";

const interval = (startMs, endMs) => ({ clockId: "clock", startMs, endMs });
const scope = interval(0, 100);

test("parallel tools, nested model calls and retries exclude waits once", () => {
  const evidence = {
    scope,
    modelIntervals: [interval(10, 40), interval(20, 50), interval(60, 70)],
    toolIntervals: [interval(30, 65), interval(35, 80), interval(85, 90)],
  };
  const original = structuredClone(evidence);
  assert.deepEqual(summarizeProcessingTiming(evidence), {
    ...scope,
    elapsedMs: 100,
    modelTransportMs: 50,
    toolExecutionOutsideModelMs: 25,
    modelToolOverlapMs: 30,
    systemMs: 25,
  });
  assert.deepEqual(evidence, original);
});

test("empty execution and touching intervals preserve wall-clock conservation", () => {
  assert.equal(
    summarizeProcessingTiming({ scope, modelIntervals: [], toolIntervals: [] }).systemMs,
    100,
  );
  const result = summarizeProcessingTiming({
    scope,
    modelIntervals: [interval(0, 50)],
    toolIntervals: [interval(50, 100), interval(60, 60)],
  });
  assert.equal(result.systemMs, 0);
  assert.equal(result.modelToolOverlapMs, 0);
  assert.equal(
    result.elapsedMs,
    result.modelTransportMs + result.toolExecutionOutsideModelMs + result.systemMs,
  );
});

test("missing, invalid, out-of-scope and cross-clock evidence is rejected", () => {
  for (const value of [
    null,
    {},
    interval(-1, 20),
    interval(10, 101),
    interval(20, 10),
    interval(0, Infinity),
    { ...interval(0, 10), clockId: "other" },
  ]) {
    assert.throws(
      () => summarizeProcessingTiming({ scope, modelIntervals: [], toolIntervals: [value] }),
      TypeError,
    );
  }
});

test("model and tool producers share a stable monotonic process clock", () => {
  const first = monotonicTiming();
  const second = monotonicTiming();
  assert.equal(first.clockId, MONOTONIC_CLOCK_ID);
  assert.equal(second.clockId, first.clockId);
  assert.ok(second.atMs >= first.atMs);
});
