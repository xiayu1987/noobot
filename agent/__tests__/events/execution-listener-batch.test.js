/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  initializePartitionReaderFixture,
  partitionReaderAccess,
} from "../helpers/partition-reader-fixture.js";
import assert from "node:assert/strict";
import test from "node:test";
import {
  EXECUTION_LOG_BATCH_MAX_RECORDS,
  EXECUTION_LOG_MAX_PENDING_RECORDS,
  executionLogByteBudget,
  encodeExecutionSegmentRecord,
} from "@noobot/session-protocol";
import { createExecutionEventListener } from "../../src/events/execution-listener.js";
import { ExecutionLogService } from "../../src/observability/execution-log/execution-log-service.js";
import { ExecutionLogRepository } from "../../src/observability/execution-log/execution-log-repository.js";
import { createSessionFacade } from "../../src/session/index.js";
import { FileSystemExecutionRepository } from "../../src/session/repositories/file-system-execution-repository.js";
import { TEST_STORAGE_SERVICE } from "../helpers/storage-service.js";
import { withTemp } from "../helpers/temporary-directory.js";
import { createTestSessionRequiredFields } from "../helpers/session-message-facts.js";
import { sessionReaderMethods } from "../../src/session/repositories/file-system-session-repository/reader-methods.js";

async function withExecutionSession(run) {
  return withTemp(async (sessionDir) => {
    await initializePartitionReaderFixture({
      sessionDir,
      operationId: "initialize-execution-listener-test",
      session: {
        ...createTestSessionRequiredFields(),
        sessionId: "s1",
        parentSessionId: "parent",
        aggregateVersion: 0,
      },
    });
    return run(sessionDir);
  });
}

function executionRepositoryFor(sessionDir) {
  return new FileSystemExecutionRepository({
    storageService: TEST_STORAGE_SERVICE,
    sessionRepository: {
      sessionReaderAccess: partitionReaderAccess,
      withSessionReader: sessionReaderMethods.withSessionReader,
      async withSessionMutation(_userId, _sessionId, write) {
        return write({ sessionDir, resolvedParentSessionId: "parent" });
      },
      async requireSessionScope() {
        return { sessionDir };
      },
    },
  });
}

function listenerFor(sessionManager, parentSessionId = "") {
  return createExecutionEventListener({
    sessionManager,
    userId: "u1",
    sessionId: "s1",
    parentSessionId,
    dialogProcessId: "d1",
    turnScopeId: "t1",
    persistenceScope: null,
    now: () => "2026-11-15T00:00:00.000Z",
  });
}
const emit = (listener, sequence) =>
  listener.onEvent({
    event: "batch_test",
    data: { sequence },
  });

test("listener coalesces asynchronous admissions and persists a lone record without flush", async () => {
  const batches = [];
  let persisted = Promise.withResolvers();
  const listener = listenerFor({
    async appendExecutionLogs({ records }) {
      batches.push(records.map(({ data }) => data.sequence));
      persisted.resolve();
    },
  });
  for (let sequence = 0; sequence < 3; sequence += 1) {
    await Promise.resolve();
    emit(listener, sequence);
  }
  await persisted.promise;
  await listener.flush();
  assert.deepEqual(batches, [[0, 1, 2]]);
  persisted = Promise.withResolvers();
  emit(listener, "lone");
  await persisted.promise;
  await listener.flush();
  assert.deepEqual(batches, [[0, 1, 2], ["lone"]]);
});

test("listener byte admission includes the resolved parent through source append and projection", async () => {
  await withExecutionSession(async (sessionDir) => {
    let admitted;
    const probe = listenerFor(
      {
        async appendExecutionLogs({ records }) {
          [admitted] = records;
        },
      },
      "parent",
    );
    probe.onEvent({ event: "batch_test", data: { text: "" } });
    await probe.flush();
    const bytes = executionLogByteBudget().batchBytes;
    const text = "x".repeat(bytes - encodeExecutionSegmentRecord(admitted).bytes);
    const executionRepository = executionRepositoryFor(sessionDir);
    const projected = [];
    const repository = new ExecutionLogRepository({
      executionRepository,
      runtimeEventWriter: async (events) => {
        projected.push(...events);
        return events.map(() => ({ ok: true }));
      },
    });
    const service = new ExecutionLogService({ executionRepo: repository });
    const listener = listenerFor(
      {
        appendExecutionLogs: (payload) => service.appendExecutionLogs(payload),
      },
      "parent",
    );
    listener.onEvent({ event: "batch_test", data: { text } });
    await listener.flush();
    const [persisted] = await executionRepository.getTurnLogs("u1", "s1", "d1");
    assert.equal(encodeExecutionSegmentRecord(persisted).bytes, bytes);
    assert.equal(persisted.parentSessionId, "parent");
    assert.equal(projected.length, 1);
    assert.equal(projected[0].data.text, text);
  });
});

test("listener batches through facade, service and file repository with one context per batch", async (t) => {
  await withExecutionSession(async (sessionDir) => {
    const persisted = [];
    const projected = [];
    const contexts = [];
    const executionRepository = executionRepositoryFor(sessionDir);
    const append = executionRepository.appendLogs.bind(executionRepository);
    t.mock.method(executionRepository, "appendLogs", async (...args) => {
      persisted.push({ records: args[2], persistenceContext: args[3].persistenceContext });
      return append(...args);
    });
    const repository = new ExecutionLogRepository({
      executionRepository,
      runtimeEventWriter: async (events) => {
        projected.push(...events);
        return events.map(() => ({ ok: true }));
      },
    });
    const sessionManager = createSessionFacade({
      executionLogService: new ExecutionLogService({ executionRepo: repository }),
      repositories: { connectorInstanceRepository: {} },
      createSessionPersistenceContext(scope) {
        contexts.push(scope);
        return scope;
      },
    });
    const listener = listenerFor(sessionManager);
    for (let sequence = 0; sequence < 205; sequence += 1) emit(listener, sequence);
    await listener.flush();
    assert.deepEqual(
      persisted.map(({ records }) => records.length),
      [100, 100, 5],
    );
    assert.equal(contexts.length, 3);
    assert.ok(contexts.every((scope) => scope.persistenceScope === null));
    assert.deepEqual(
      projected.map(({ data }) => data.sequence),
      Array.from({ length: 205 }, (_, i) => i),
    );
    assert.ok(projected.every((event) => event.parentSessionId === "parent"));
    assert.equal(repository.appendQueues.size, 0);
    assert.equal(new Set(projected.map(({ data }) => data.executionLogSourceId)).size, 205);
    const restarted = new ExecutionLogRepository({
      executionRepository: executionRepositoryFor(sessionDir),
      runtimeEventWriter: async () => {
        throw new Error("acknowledged records must not replay");
      },
    });
    await restarted.recoverLogProjection("u1", "s1", ["d1"]);
  });
});

test("listener bounds outstanding records including the active batch and accepts work after drain", async () => {
  const started = Promise.withResolvers();
  const released = Promise.withResolvers();
  const persisted = [];
  let first = true;
  const listener = listenerFor({
    async appendExecutionLogs({ records }) {
      assert.ok(records.length <= EXECUTION_LOG_BATCH_MAX_RECORDS);
      if (first) {
        first = false;
        started.resolve();
        await released.promise;
      }
      persisted.push(...records);
    },
  });
  emit(listener, 0);
  await started.promise;
  for (let sequence = 1; sequence < EXECUTION_LOG_MAX_PENDING_RECORDS; sequence += 1) {
    emit(listener, sequence);
  }
  assert.throws(() => emit(listener, "rejected"), { code: "EXECUTION_LOG_BACKPRESSURE_REQUIRED" });
  released.resolve();
  await listener.flush();
  assert.equal(persisted.length, EXECUTION_LOG_MAX_PENDING_RECORDS);
  await emit(listener, "after-drain");
  await listener.flush();
  assert.equal(persisted.at(-1).data.sequence, "after-drain");
});

test("runtime batch failure retains committed records and recovers from the durable source", async (t) => {
  await withExecutionSession(async (sessionDir) => {
    const diskFailure = new Error("projection disk full");
    let appendCalls = 0;
    let projectionCalls = 0;
    let attempted;
    const executionRepository = executionRepositoryFor(sessionDir);
    const append = executionRepository.appendLogs.bind(executionRepository);
    t.mock.method(executionRepository, "appendLogs", async (...args) => {
      appendCalls += 1;
      return append(...args);
    });
    const repository = new ExecutionLogRepository({
      executionRepository,
      runtimeEventWriter: async (events) => {
        projectionCalls += 1;
        attempted = events;
        return events.map((_, index) =>
          index === 1 ? { ok: false, error: diskFailure } : { ok: true },
        );
      },
    });
    const records = Array.from({ length: 3 }, (_, sequence) => ({
      dialogProcessId: "d1",
      event: "batch_test",
      ts: "2026-11-15T00:00:00.000Z",
      data: { sequence },
    }));
    await assert.rejects(repository.appendLogs("u1", "s1", records), (error) => {
      assert.equal(error.code, "EXECUTION_LOG_PROJECTION_FAILED");
      assert.equal(error.commitState, "committed");
      assert.equal(error.cause, diskFailure);
      assert.deepEqual(error.projection.outcomes, ["written", "failed", "written"]);
      assert.deepEqual(
        error.projection.records.map(({ data }) => data.sequence),
        [0, 1, 2],
      );
      return true;
    });
    assert.equal(appendCalls, 1);
    assert.equal(projectionCalls, 1);
    assert.equal(repository.appendQueues.size, 0);
    const recovered = [];
    const restarted = new ExecutionLogRepository({
      executionRepository: executionRepositoryFor(sessionDir),
      runtimeEventWriter: async (events) => {
        recovered.push(...events);
        return events.map(() => ({ ok: true }));
      },
    });
    await restarted.recoverLogProjection("u1", "s1", ["d1"]);
    await restarted.recoverLogProjection("u1", "s1", ["d1"]);
    assert.equal(appendCalls, 1);
    assert.deepEqual(
      recovered.map(({ data }) => data.executionLogSourceId),
      attempted.map(({ data }) => data.executionLogSourceId),
    );
    assert.deepEqual(
      (await executionRepository.getTurnLogs("u1", "s1", "d1")).map(({ data }) => data.sequence),
      [0, 1, 2],
    );
  });
});
