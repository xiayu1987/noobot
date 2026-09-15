/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  createExecutionCancellationScope,
  resolveExecutionCancellationScope,
  withExecutionCancellationScope,
} from "../src/lifecycle/execution-cancellation-scope.js";

test("scope runs registered disposers once when the bound signal aborts", () => {
  const controller = new AbortController();
  const scope = createExecutionCancellationScope({ abortSignal: controller.signal });
  let closed = 0;
  scope.register(() => {
    closed += 1;
  });
  assert.equal(closed, 0);
  controller.abort();
  assert.equal(closed, 1);
  assert.equal(scope.disposed, true);
  scope.dispose();
  assert.equal(closed, 1);
});

test("scope exposes the bound signal as its only cancellation source", () => {
  const controller = new AbortController();
  const scope = createExecutionCancellationScope({ abortSignal: controller.signal });
  assert.equal(scope.abortSignal, controller.signal);
  assert.equal(createExecutionCancellationScope().abortSignal, null);
});

test("disposer registered after abort runs immediately so resources never leak", () => {
  const controller = new AbortController();
  controller.abort();
  const scope = createExecutionCancellationScope({ abortSignal: controller.signal });
  let closed = 0;
  scope.register(() => {
    closed += 1;
  });
  assert.equal(closed, 1);
});

test("disposer failure is reported without breaking the remaining disposers", () => {
  const controller = new AbortController();
  const reported = [];
  const scope = createExecutionCancellationScope({
    abortSignal: controller.signal,
    onDisposeError: (error) => reported.push(error),
  });
  let closed = 0;
  scope.register(() => {
    throw new Error("close failed");
  });
  scope.register(() => {
    closed += 1;
  });
  controller.abort();
  assert.equal(closed, 1);
  assert.equal(reported.length, 1);
  assert.equal(reported[0].message, "close failed");
});

test("rejected async disposer is reported instead of becoming an unhandled rejection", async () => {
  const controller = new AbortController();
  const reported = [];
  const scope = createExecutionCancellationScope({
    abortSignal: controller.signal,
    onDisposeError: (error) => reported.push(error),
  });
  scope.register(() => Promise.reject(new Error("async close failed")));
  controller.abort();
  await Promise.resolve();
  assert.equal(reported.length, 1);
  assert.equal(reported[0].message, "async close failed");
});

test("unregister handle drops the disposer so completed work is not closed twice", () => {
  const controller = new AbortController();
  const scope = createExecutionCancellationScope({ abortSignal: controller.signal });
  let closed = 0;
  const release = scope.register(() => {
    closed += 1;
  });
  assert.equal(scope.size, 1);
  release();
  assert.equal(scope.size, 0);
  controller.abort();
  assert.equal(closed, 0);
});

test("missing scope resolves to a no-op scope so callers need no branching", () => {
  const scope = resolveExecutionCancellationScope(null);
  assert.equal(typeof scope.register, "function");
  assert.equal(scope.abortSignal, null);
  assert.equal(typeof scope.register(() => {}), "function");
});

test("withExecutionCancellationScope unregisters on the normal completion path", async () => {
  const controller = new AbortController();
  const scope = createExecutionCancellationScope({ abortSignal: controller.signal });
  let closed = 0;
  const result = await withExecutionCancellationScope(
    scope,
    () => {
      closed += 1;
    },
    async () => "done",
  );
  assert.equal(result, "done");
  assert.equal(scope.size, 0);
  controller.abort();
  assert.equal(closed, 0);
});

test("withExecutionCancellationScope unregisters when the body throws", async () => {
  const scope = createExecutionCancellationScope({ abortSignal: new AbortController().signal });
  await assert.rejects(
    withExecutionCancellationScope(
      scope,
      () => {},
      async () => {
        throw new Error("body failed");
      },
    ),
    /body failed/,
  );
  assert.equal(scope.size, 0);
});
