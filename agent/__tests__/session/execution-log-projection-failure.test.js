/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { ExecutionLogRepository } from "../../src/observability/execution-log/execution-log-repository.js";
import { withExecutionLogProjection } from "../helpers/execution-log-projection-port.js";

const log = { dialogProcessId: "d1", event: "start", ts: "2026-05-13T00:00:00.000Z" };

test("failed execution append never publishes a runtime projection and releases its queue", async () => {
  const failure = new Error("append failed");
  let rejectAppend = true;
  const projected = [];
  const repo = new ExecutionLogRepository({
    executionRepository: withExecutionLogProjection({
      async appendLogs(userId, sessionId, records) {
        if (rejectAppend) throw failure;
        return records.map((record) => ({
          ...record,
          userId,
          sessionId,
          parentSessionId: "canonical-parent",
        }));
      },
    }),
  });
  repo.runtimeEventWriter = async (events) => {
    projected.push(...events);
    return events.map(() => ({ ok: true }));
  };
  await assert.rejects(repo.appendLog("u1", "s1", log), (error) => error === failure);
  assert.equal(projected.length, 0);
  assert.equal(repo.appendQueues.size, 0);
  rejectAppend = false;
  await repo.appendLog("u1", "s1", log);
  assert.equal(projected.length, 1);
  assert.equal(projected[0].parentSessionId, "canonical-parent");
});

test("projection failure is propagated after persistence without blocking subsequent appends", async () => {
  const failure = new Error("projection failed");
  const persisted = [];
  const repo = new ExecutionLogRepository({
    executionRepository: withExecutionLogProjection({
      async appendLogs(userId, sessionId, records) {
        const result = records.map((record) => ({
          ...record,
          userId,
          sessionId,
          parentSessionId: "canonical-parent",
        }));
        persisted.push(...result);
        return result;
      },
    }),
  });
  repo.runtimeEventWriter = async () => {
    throw failure;
  };
  await assert.rejects(repo.appendLog("u1", "s1", log), (error) => {
    assert.equal(error.cause, failure);
    assert.equal(error.commitState, "committed");
    assert.equal(error.code, "EXECUTION_LOG_PROJECTION_FAILED");
    assert.deepEqual(error.projection.outcomes, ["unknown"]);
    return true;
  });
  assert.equal(persisted.length, 1);
  assert.equal(repo.appendQueues.size, 0);
  repo.runtimeEventWriter = async (events) => events.map(() => ({ ok: true }));
  await repo.appendLog("u1", "s1", log);
  assert.equal(persisted.length, 2);
});
