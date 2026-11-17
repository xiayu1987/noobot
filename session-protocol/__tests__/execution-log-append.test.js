/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { executionLogAppendFailure } from "../src/aggregate/execution-log-append.js";

test("source append outcomes require complete positional evidence", () => {
  const failure = new Error("write failed");
  for (const outcomes of [undefined, [], Array(1), ["skipped"], ["failed"]])
    assert.throws(() => executionLogAppendFailure(failure, [{}], outcomes), TypeError);
  assert.equal(executionLogAppendFailure(failure, [{}], ["not_written"]), failure);
});

test("source durability classifies partial and uncertain writes independently of projection", () => {
  const failure = new Error("write failed");
  for (const [outcomes, expected] of [
    [["written", "written"], "committed"],
    [["written", "not_written"], "partial"],
    [["written", "unknown"], "unknown"],
  ]) {
    const error = executionLogAppendFailure(failure, [{}, {}], outcomes);
    assert.equal(error.commitState, expected);
    assert.equal(error.cause, failure);
    assert.deepEqual(error.append.outcomes, outcomes);
    outcomes[0] = "not_written";
    assert.equal(error.append.outcomes[0], "written");
  }
});
