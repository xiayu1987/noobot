/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { runStorageBatch } from "../../src/session/session-artifact-session/storage-batch-results.js";

test("a failed value batch drains admitted writes and preserves every concurrent failure", async () => {
  const concurrency = QUANTITY_THRESHOLDS.immutableStorage.recordIoConcurrency;
  assert.ok(concurrency > 1, "fault scenario requires concurrent value writes");
  const first = new Error("first value write failed");
  const second = new Error("another admitted value write failed");
  const releases = Array.from({ length: concurrency }, () => Promise.withResolvers());
  const started = [];
  let settled = false;
  const batch = runStorageBatch(
    Array.from({ length: concurrency + 1 }, (_, index) => index),
    async (index) => {
      started.push(index);
      await releases[index].promise;
    },
  );
  const observed = batch.then(
    () => {
      settled = true;
      assert.fail("a failed write batch must reject");
    },
    (error) => {
      settled = true;
      return error;
    },
  );
  assert.equal(started.length, concurrency);
  releases[0].reject(first);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, "failure must wait for all admitted writes");
  assert.equal(started.length, concurrency, "failure must stop further admission");
  releases[1].reject(second);
  for (const release of releases.slice(2)) release.resolve();
  const error = await observed;
  assert.ok(error instanceof AggregateError);
  assert.deepEqual(error.errors, [first, second]);
  assert.equal(error.cause, first);
  assert.equal(started.length, concurrency);
});

test("one failed value write preserves the original error identity", async () => {
  const failure = new Error("single value write failed");
  await assert.rejects(
    runStorageBatch([1], async () => {
      throw failure;
    }),
    (error) => error === failure,
  );
});
