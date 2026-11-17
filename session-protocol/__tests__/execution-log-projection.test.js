/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  executionLogProjectionFailure,
  requireExecutionLogProjectionDelivery,
} from "../src/index.js";

test("projection acknowledgement rejects absent, partial and sparse delivery outcomes", () => {
  const records = [{}, {}];
  for (const outcomes of [
    undefined,
    [],
    ["written"],
    Array(2),
    ["written", "unknown"],
    ["written", "failed"],
  ])
    assert.throws(() => requireExecutionLogProjectionDelivery(records, outcomes), TypeError);
  assert.deepEqual(requireExecutionLogProjectionDelivery(records, ["written", "skipped"]), [
    "written",
    "skipped",
  ]);
  assert.throws(
    () => executionLogProjectionFailure(new Error("failure"), records, Array(2)),
    TypeError,
  );
});

test("outer source acceptance preserves classified delivery records and their original cause", () => {
  const cause = new Error("cursor not published");
  const records = [{ event: "first" }, { event: "second" }];
  const failure = executionLogProjectionFailure(cause, records, ["written", "skipped"]);
  assert.equal(executionLogProjectionFailure(failure, [{}], ["unknown"]), failure);
  assert.equal(failure.cause, cause);
  assert.equal(failure.commitState, "committed");
  assert.deepEqual(failure.projection, { records, outcomes: ["written", "skipped"] });
});
