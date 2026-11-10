/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { normalizeRetryPolicy, resolveModelRetryDelay, SYSTEM_CLOCK_PORT } from "../src/index.js";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

test("exponential retry delay is capped without shortening provider minimum wait", () => {
  const limit = TIME_THRESHOLDS.model.maxRetryDelayMs;
  assert.equal(resolveModelRetryDelay({ attempt: 10000, baseDelayMs: 250 }), limit);
  assert.equal(resolveModelRetryDelay({ attempt: 1, baseDelayMs: 250, retryAfterMs: 2000 }), 2000);
  for (const retryAfterMs of [limit + 1, 3000000000, Infinity])
    assert.throws(() => resolveModelRetryDelay({ attempt: 1, baseDelayMs: 250, retryAfterMs }), {
      kind: "protocol",
      message: "provider retry wait exceeds the allowed budget",
    });
});

test("media generation rejects a contradictory total retry budget", () => {
  assert.equal(normalizeRetryPolicy({}, "media_generation").maxTotalAttempts, 1);
  assert.throws(
    () => normalizeRetryPolicy({ maxTotalAttempts: 3 }, "media_generation"),
    /must be one/,
  );
});

test("clock cancellation rejects immediately and releases its abort listener", async () => {
  const controller = new AbortController();
  const waiting = SYSTEM_CLOCK_PORT.sleep(TIME_THRESHOLDS.model.maxRetryDelayMs, {
    signal: controller.signal,
  });
  assert.equal(getEventListeners(controller.signal, "abort").length, 1);
  controller.abort();
  await assert.rejects(waiting, { name: "AbortError" });
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  await assert.rejects(SYSTEM_CLOCK_PORT.sleep(0, { signal: controller.signal }), {
    name: "AbortError",
  });
});

test("completed clock wait removes its abort listener", async () => {
  const controller = new AbortController();
  await SYSTEM_CLOCK_PORT.sleep(0, { signal: controller.signal });
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});
