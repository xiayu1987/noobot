/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createExecutionEventListener } from "../../src/events/execution-listener.js";

const route = {
  userId: "u1",
  sessionId: "s1",
  parentSessionId: "",
  dialogProcessId: "d1",
  turnScopeId: "t1",
};

for (const asynchronous of [false, true]) {
  test(`timing ${asynchronous ? "rejection" : "throw"} cannot hide persistence failure`, async () => {
    const timingFailure = new Error("timing delivery failed");
    const persistenceFailure = new Error("log durability failed");
    let timingCalls = 0;
    const listener = createExecutionEventListener({
      ...route,
      persistenceScope: null,
      now: () => "2026-11-16T00:00:00.000Z",
      sessionManager: {
        async appendExecutionLogs() {
          throw persistenceFailure;
        },
      },
      upstream: {
        async onEvent() {},
        onDeliveryTiming() {
          timingCalls += 1;
          if (asynchronous) return Promise.reject(timingFailure);
          throw timingFailure;
        },
      },
    });
    listener.onEvent({ event: "batch_test", data: {} });
    await listener.forwardEvent({ event: "message", data: {}, route });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await assert.rejects(listener.flush(), (error) => {
        assert.equal(error.code, "EXECUTION_EVENT_FLUSH_FAILED");
        assert.equal(error.errors.length, 2);
        assert.equal(error.errors[0].code, "EVENT_UPSTREAM_DELIVERY_FAILED");
        assert.equal(error.errors[0].failures[0].sourceEvent, "execution_delivery_timing");
        assert.equal(error.errors[0].failures[0].error, timingFailure.message);
        assert.equal(error.errors[1].cause, persistenceFailure);
        return true;
      });
    }
    assert.equal(timingCalls, 1);
  });
}

test("concurrent flushes await timing acknowledgement and logs accepted during it", async () => {
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  const persistenceStarted = Promise.withResolvers();
  const persistenceRelease = Promise.withResolvers();
  const listener = createExecutionEventListener({
    ...route,
    persistenceScope: null,
    now: () => "2026-11-16T00:00:00.000Z",
    sessionManager: {
      async appendExecutionLogs() {
        persistenceStarted.resolve();
        await persistenceRelease.promise;
      },
    },
    upstream: {
      async onEvent() {},
      async onDeliveryTiming() {
        started.resolve();
        await release.promise;
      },
    },
  });
  await listener.forwardEvent({ event: "message", data: {}, route });
  let completed = 0;
  const flushing = listener.flush().then(() => {
    completed += 1;
  });
  await started.promise;
  const concurrent = listener.flush().then(() => {
    completed += 1;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(completed, 0);
  listener.onEvent({ event: "batch_test", data: {} });
  await persistenceStarted.promise;
  release.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(completed, 0);
  persistenceRelease.resolve();
  await Promise.all([flushing, concurrent]);
  assert.equal(completed, 2);
});
