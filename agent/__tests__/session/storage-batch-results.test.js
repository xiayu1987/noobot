/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { assertStorageBatchSucceeded } from "../../src/session/storage-batch-results.js";

test("storage batch results expose all failures in input order", async () => {
  const first = new Error("first read failed");
  const last = new Error("last read failed");
  const results = await Promise.allSettled([
    Promise.reject(first),
    Promise.resolve(null),
    Promise.reject(last),
  ]);
  assert.throws(
    () => assertStorageBatchSucceeded(results),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [first, last]);
      assert.equal(error.cause, first);
      return true;
    },
  );
});

test("one failed storage operation preserves the original error identity", async () => {
  const failure = new Error("read failed");
  const results = await Promise.allSettled([Promise.reject(failure)]);
  assert.throws(
    () => assertStorageBatchSucceeded(results),
    (error) => error === failure,
  );
});
