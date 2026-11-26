/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { setImmediate as nextEventLoopTurn } from "node:timers/promises";
import {
  EXECUTION_LOG_BATCH_MAX_RECORDS,
  EXECUTION_LOG_MAX_PENDING_RECORDS,
  executionLogByteBudget,
  executionLogBatchWaitBudget,
  executionLogQueueWaitBudget,
  executionLogQueueWaitFailure,
  prepareExecutionLogRecord,
} from "@noobot/session-protocol";
import { omitExecutionRouteIdentity } from "./transport-payload.js";

function takeBatch(pending, byteBudget) {
  let count = 0;
  let bytes = 0;
  while (count < pending.length && count < EXECUTION_LOG_BATCH_MAX_RECORDS) {
    const nextBytes = pending[count].bytes;
    if (bytes + nextBytes > byteBudget.batchBytes) break;
    bytes += nextBytes;
    count += 1;
  }
  return { records: pending.splice(0, count).map((entry) => entry.record), bytes };
}

export function createExecutionLogQueue({ sessionManager, route, persistenceScope }) {
  const byteBudget = executionLogByteBudget();
  const queueWaitBudget = executionLogQueueWaitBudget();
  const batchWaitBudget = executionLogBatchWaitBudget();
  const failures = [];
  const pending = [];
  let tail = Promise.resolve();
  let pendingCount = 0;
  let pendingBytes = 0;
  let draining = false;
  let flushing = 0;
  let wakeBatch;

  const batchReady = () =>
    flushing > 0 ||
    pending.length >= EXECUTION_LOG_BATCH_MAX_RECORDS ||
    pendingBytes >= byteBudget.batchBytes;

  const waitForBatch = async () => {
    if (batchReady()) return;
    const remaining = pending[0].enqueuedAt + batchWaitBudget - performance.now();
    if (remaining <= 0) return;
    await new Promise((resolve) => {
      const timer = setTimeout(() => wakeBatch(), remaining);
      wakeBatch = () => {
        clearTimeout(timer);
        wakeBatch = undefined;
        resolve();
      };
    });
  };

  const recordFailure = (event, cause) => {
    failures.push({ event, error: cause?.message || String(cause), cause });
  };

  const persistBatch = async ({ records, bytes }) => {
    try {
      await sessionManager.appendExecutionLogs({
        userId: route.userId,
        sessionId: route.sessionId,
        records,
        persistenceScope,
      });
    } catch (cause) {
      recordFailure(records[0].event, cause);
    } finally {
      pendingCount -= records.length;
      pendingBytes -= bytes;
    }
  };

  const drainBatches = async () => {
    while (pending.length > 0) {
      await waitForBatch();
      await persistBatch(takeBatch(pending, byteBudget));
    }
  };

  const drain = async () => {
    try {
      await drainBatches();
    } finally {
      draining = false;
    }
  };

  const append = (record) => {
    const enqueuedAt = performance.now();
    if (pendingCount >= EXECUTION_LOG_MAX_PENDING_RECORDS) {
      const error = new Error("execution log pending record limit exceeded; await event delivery");
      error.code = "EXECUTION_LOG_BACKPRESSURE_REQUIRED";
      throw error;
    }
    const prepared = prepareExecutionLogRecord({
      ...record,
      ...route,
      data: omitExecutionRouteIdentity(record?.data),
    });
    if (pendingBytes + prepared.bytes > byteBudget.pendingBytes)
      throw Object.assign(
        new Error("execution log pending byte limit exceeded; await event delivery"),
        {
          code: "EXECUTION_LOG_BACKPRESSURE_REQUIRED",
        },
      );
    pending.push({ ...prepared, enqueuedAt });
    pendingCount += 1;
    pendingBytes += prepared.bytes;
    if (batchReady()) wakeBatch?.();
    if (!draining) {
      draining = true;
      tail = nextEventLoopTurn().then(drain);
    }
    return tail;
  };
  return {
    append,
    get backpressured() {
      return (
        pending.length > 0 &&
        executionLogQueueWaitFailure(performance.now() - pending[0].enqueuedAt, queueWaitBudget) !==
          null
      );
    },
    async flush() {
      flushing += 1;
      wakeBatch?.();
      try {
        await tail;
      } finally {
        flushing -= 1;
      }
    },
    recordFailure,
    failures,
    get tail() {
      return tail;
    },
  };
}
