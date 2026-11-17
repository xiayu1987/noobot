/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { assertToolCallTimingInterval } from "../src/tool-timing.js";

const timing = () => ({
  toolCallId: "tool",
  executionMs: 30,
  frameworkMs: 70,
  interval: { clockId: "clock", startMs: 0, endMs: 100, execution: { startMs: 20, endMs: 50 } },
});

test("execution interval accounts for only invocation time, including thrown calls", () => {
  const value = timing();
  assert.equal(assertToolCallTimingInterval(value), value);
  assertToolCallTimingInterval({
    ...value,
    executionMs: 0,
    frameworkMs: 100,
    interval: { ...value.interval, execution: null },
  });
});

test("incomplete, inconsistent or out-of-bounds tool evidence is rejected", () => {
  for (const mutate of [
    (value) => delete value.interval,
    (value) => (value.interval.clockId = ""),
    (value) => (value.interval.startMs = -1),
    (value) => (value.interval.endMs = NaN),
    (value) => delete value.interval.execution,
    (value) => (value.interval.execution.startMs = -1),
    (value) => (value.interval.execution.endMs = 101),
    (value) => (value.interval.execution.endMs = 1),
    (value) => (value.executionMs = 31),
    (value) => (value.frameworkMs = 71),
  ]) {
    const value = timing();
    mutate(value);
    assert.throws(() => assertToolCallTimingInterval(value), TypeError);
  }
});
