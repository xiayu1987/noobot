/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  executionLogQueueWaitBudget,
  executionLogQueueWaitFailure,
} from "@noobot/session-protocol";
import { createExecutionEventListener } from "../../src/events/execution-listener.js";

const route = {
  userId: "u1",
  sessionId: "s1",
  parentSessionId: "",
  dialogProcessId: "d1",
  turnScopeId: "t1",
};
const emit = (listener, sequence) => listener.onEvent({ event: "wait_test", data: { sequence } });
const createListener = (appendExecutionLogs, upstream = null) =>
  createExecutionEventListener({
    ...route,
    persistenceScope: null,
    now: () => "2026-11-15T00:00:00.000Z",
    sessionManager: { appendExecutionLogs },
    upstream,
  });

function clockFor(t) {
  let value = 0;
  t.mock.method(performance, "now", () => value);
  return (time) => {
    value = time;
  };
}

test("queue wait protocol accepts its boundary and reports structured budget violations", () => {
  const budget = executionLogQueueWaitBudget();
  assert.ok(budget > 0);
  assert.equal(executionLogQueueWaitFailure(budget, budget), null);
  const error = executionLogQueueWaitFailure(budget + 1, budget);
  assert.equal(error.code, "EXECUTION_LOG_QUEUE_WAIT_EXCEEDED");
  assert.equal(error.waitMs, budget + 1);
  assert.equal(error.maxWaitMs, budget);
  for (const [wait, max] of [
    [-1, budget],
    [NaN, budget],
    [0, 0],
    [0, Infinity],
  ]) {
    assert.throws(() => executionLogQueueWaitFailure(wait, max), RangeError);
  }
});

for (const fails of [false, true]) {
  test(`overdue queue rejects admission and drains accepted records after write ${fails ? "failure" : "success"}`, async (t) => {
    const setTime = clockFor(t);
    const budget = executionLogQueueWaitBudget();
    const started = Promise.withResolvers();
    const release = Promise.withResolvers();
    t.after(() => release.resolve());
    const batches = [];
    let first = true;
    const listener = createListener(async ({ records }) => {
      batches.push(records.map(({ data }) => data.sequence));
      if (first) {
        first = false;
        started.resolve();
        await release.promise;
        if (fails) throw new Error("disk failure");
      }
    });
    emit(listener, "active");
    await started.promise;
    emit(listener, "queued");
    setTime(budget);
    emit(listener, "at-boundary");
    setTime(budget + 1);
    assert.throws(
      () => emit(listener, "rejected"),
      (error) => {
        assert.equal(error.code, "EXECUTION_LOG_BACKPRESSURE_REQUIRED");
        assert.equal(error.cause.code, "EXECUTION_LOG_QUEUE_WAIT_EXCEEDED");
        return true;
      },
    );
    release.resolve();
    await assert.rejects(listener.flush(), (error) => {
      assert.equal(error.code, "EXECUTION_LOG_PERSISTENCE_FAILED");
      assert.ok(
        error.failures.some(({ error }) => error === "execution log queue wait budget exceeded"),
      );
      assert.equal(error.failures.length, fails ? 2 : 1);
      return true;
    });
    assert.deepEqual(batches, [["active"], ["queued", "at-boundary"]]);
    await emit(listener, "after-drain");

    await assert.rejects(listener.flush(), { code: "EXECUTION_LOG_PERSISTENCE_FAILED" });
    assert.deepEqual(batches.at(-1), ["after-drain"]);
  });
}

test("flush reports overdue accepted records even when no producer attempts another admission", async (t) => {
  const setTime = clockFor(t);
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  t.after(() => release.resolve());
  const persisted = [];
  const listener = createListener(async ({ records }) => {
    if (records[0].data.sequence === 0) {
      started.resolve();
      await release.promise;
    }
    persisted.push(...records.map(({ data }) => data.sequence));
  });
  emit(listener, 0);
  await started.promise;
  emit(listener, 1);
  setTime(executionLogQueueWaitBudget() + 1);
  let settled = false;
  const completion = assert
    .rejects(listener.flush(), (error) => {
      assert.equal(error.cause.code, "EXECUTION_LOG_QUEUE_WAIT_EXCEEDED");
      return true;
    })
    .then(() => {
      settled = true;
    });
  await Promise.resolve();
  assert.equal(settled, false);
  release.resolve();
  await completion;
  assert.deepEqual(persisted, [0, 1]);
});

test("active persistence duration alone does not consume the queue wait budget", async (t) => {
  const setTime = clockFor(t);
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  t.after(() => release.resolve());
  const persisted = [];
  let first = true;
  const listener = createListener(async ({ records }) => {
    if (first) {
      first = false;
      started.resolve();
      await release.promise;
    }
    persisted.push(...records.map(({ data }) => data.sequence));
  });
  emit(listener, 0);
  await started.promise;
  setTime(executionLogQueueWaitBudget() * 2);
  emit(listener, 1);
  release.resolve();
  await listener.flush();
  assert.deepEqual(persisted, [0, 1]);
});

test("overdue diagnostic admission preserves subsequent delivery and the final combined failure", async (t) => {
  const setTime = clockFor(t);
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  t.after(() => release.resolve());
  const delivered = [];
  const persisted = [];
  const listener = createListener(
    async ({ records }) => {
      started.resolve();
      await release.promise;
      persisted.push(...records.map(({ data }) => data.sequence));
    },
    {
      async onEvent({ data }) {
        delivered.push(data.presentationMessageId);
        return data.presentationMessageId !== "failed";
      },
    },
  );
  emit(listener, 0);
  await started.promise;
  emit(listener, 1);
  setTime(executionLogQueueWaitBudget() + 1);
  assert.equal(
    await listener.forwardEvent({
      event: "message",
      data: { presentationMessageId: "failed" },
      route,
    }),
    false,
  );
  await listener.forwardEvent({ event: "message", data: { presentationMessageId: "next" }, route });
  release.resolve();
  await assert.rejects(listener.flush(), (error) => {
    assert.equal(error.code, "EXECUTION_EVENT_FLUSH_FAILED");
    assert.equal(error.errors[0].code, "EVENT_UPSTREAM_DELIVERY_FAILED");
    assert.equal(error.errors[1].cause.code, "EXECUTION_LOG_BACKPRESSURE_REQUIRED");
    assert.equal(error.errors[1].cause.cause.code, "EXECUTION_LOG_QUEUE_WAIT_EXCEEDED");
    return true;
  });
  assert.deepEqual(delivered, ["failed", "next"]);
  assert.deepEqual(persisted, [0, 1]);
});
