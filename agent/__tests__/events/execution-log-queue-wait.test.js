/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import {
  EXECUTION_LOG_BATCH_MAX_RECORDS,
  executionLogBatchWaitBudget,
  executionLogByteBudget,
  prepareExecutionLogRecord,
} from "@noobot/session-protocol";
import { createExecutionLogQueue } from "../../src/events/execution-log-queue.js";

const route = {
  userId: "user",
  sessionId: "session",
  parentSessionId: "",
  dialogProcessId: "dialog",
  turnScopeId: "turn",
};
const record = (sequence) => ({ event: "queue_test", data: { sequence } });
const queueFor = (appendExecutionLogs) =>
  createExecutionLogQueue({
    sessionManager: { appendExecutionLogs },
    route,
    persistenceScope: null,
  });

test("batch wait groups records across IO turns and automatically persists a lone record", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const batches = [];
  const queue = queueFor(async ({ records }) => batches.push(records));
  queue.append(record(0));
  await nextTurn();
  queue.append(record(1));
  await nextTurn();
  assert.equal(batches.length, 0);
  t.mock.timers.tick(executionLogBatchWaitBudget() + 1);
  await queue.tail;
  assert.deepEqual(
    batches[0].map(({ data }) => data.sequence),
    [0, 1],
  );
  queue.append(record(2));
  await nextTurn();
  t.mock.timers.tick(executionLogBatchWaitBudget() + 1);
  await queue.tail;
  assert.deepEqual(
    batches[1].map(({ data }) => data.sequence),
    [2],
  );
});

test("a full batch wakes its pending timer without extending the first record deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const batches = [];
  const queue = queueFor(async ({ records }) => batches.push(records));
  queue.append(record(0));
  await nextTurn();
  for (let index = 1; index < EXECUTION_LOG_BATCH_MAX_RECORDS; index += 1)
    queue.append(record(index));
  await queue.tail;
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, EXECUTION_LOG_BATCH_MAX_RECORDS);
  t.mock.timers.tick(executionLogBatchWaitBudget() + 1);
  assert.equal(batches.length, 1);
});

test("flush cancels batch waiting and waits for admissions made during persistence", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  const batches = [];
  const queue = queueFor(async ({ records }) => {
    batches.push(records);
    if (batches.length === 1) {
      started.resolve();
      await release.promise;
    }
  });
  queue.append(record(0));
  await nextTurn();
  let finished = false;
  const flushed = queue.flush().then(() => {
    finished = true;
  });
  await started.promise;
  assert.equal(finished, false);
  queue.append(record(1));
  release.resolve();
  await flushed;
  assert.deepEqual(
    batches.map((batch) => batch.map(({ data }) => data.sequence)),
    [[0], [1]],
  );
  assert.equal(finished, true);
});

test("encoded byte saturation wakes a partial batch and preserves ordered splitting", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const batches = [];
  const queue = queueFor(async ({ records }) => batches.push(records));
  const half = Math.floor(executionLogByteBudget().batchBytes / 2) + 1;
  const empty = { event: "queue_test", data: { text: "" } };
  const baseBytes = prepareExecutionLogRecord({ ...empty, ...route }).bytes;
  const large = { ...empty, data: { text: "x".repeat(half - baseBytes) } };
  queue.append(large);
  await nextTurn();
  queue.append(large);
  await nextTurn();
  assert.equal(batches.length, 1);
  await queue.flush();
  assert.deepEqual(
    batches.map((batch) => batch.length),
    [1, 1],
  );
});

test("flush exposes persistence failures after waking the batch instead of reporting success early", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const failure = new Error("durable append unavailable");
  const queue = queueFor(async () => {
    throw failure;
  });
  queue.append(record(0));
  await nextTurn();
  await queue.flush();
  assert.equal(queue.failures.length, 1);
  assert.equal(queue.failures[0].cause, failure);
});
