/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { invokeCapabilityModelWithinDeadline } from "../../src/core/capability-model-invocation.js";

test("capability-model deadline aborts and settles before the enclosing hook deadline", async () => {
  let invocationSignal = null;
  const startedAt = Date.now();

  await assert.rejects(
    invokeCapabilityModelWithinDeadline({
      timeoutMs: 20,
      invoker: async ({ signal }) => {
        invocationSignal = signal;
        await new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
    }),
    (error) => error?.code === "CAPABILITY_MODEL_TIMEOUT" && error?.timeoutMs === 20,
  );

  assert.equal(invocationSignal?.aborted, true);
  assert.ok(Date.now() - startedAt < 200);
});

test("parent hook cancellation remains the authoritative abort reason", async () => {
  const parent = new AbortController();
  const parentError = new Error("parent stopped");
  parentError.code = "HOOK_PARENT_ABORTED";
  setTimeout(() => parent.abort(parentError), 10);

  await assert.rejects(
    invokeCapabilityModelWithinDeadline({
      timeoutMs: 1000,
      parentSignal: parent.signal,
      invoker: async ({ signal }) =>
        await new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    }),
    (error) => error === parentError,
  );
});
