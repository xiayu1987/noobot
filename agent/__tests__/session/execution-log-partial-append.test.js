/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  appendRollingJsonlArtifactLogs,
  readTurnExecutionLogs,
  resolveExecutionTurnDir,
} from "../../src/session/session-artifact-execution-logs.js";
import { getFsAdapter, setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { ExecutionLogRepository } from "../../src/observability/execution-log/execution-log-repository.js";
import { FileSystemExecutionRepository } from "../../src/session/repositories/file-system-execution-repository.js";
import { TEST_STORAGE_SERVICE } from "../helpers/storage-service.js";
import { withTemp } from "../helpers/temporary-directory.js";

const record = (id, dialogProcessId = "turn-1") => ({ id, dialogProcessId });
const append = (sessionDir, logs, storageService = TEST_STORAGE_SERVICE, maxSegmentBytes = 4096) =>
  appendRollingJsonlArtifactLogs({
    sessionDir,
    logs,
    storageService,
    maxSegmentBytes,
    alreadyLocked: false,
  });

test("cross-turn failure preserves the durable prefix and identifies untouched records", async () => {
  await withTemp(async (sessionDir) => {
    const failure = new Error("second turn preparation failed");
    const secondIndex = path.join(resolveExecutionTurnDir(sessionDir, "turn-2"), "index.json");
    const storage = Object.assign(Object.create(TEST_STORAGE_SERVICE), {
      async writeJsonAtomic(file, value) {
        if (file === secondIndex) throw failure;
        return TEST_STORAGE_SERVICE.writeJsonAtomic(file, value);
      },
    });
    const logs = [record(1), record(2, "turn-2"), record(3)];
    await assert.rejects(append(sessionDir, logs, storage), (error) => {
      assert.equal(error.code, "EXECUTION_LOG_APPEND_FAILED");
      assert.equal(error.cause, failure);
      assert.equal(error.commitState, "partial");
      assert.deepEqual(error.append.records, logs);
      assert.deepEqual(error.append.outcomes, ["written", "not_written", "not_written"]);
      return true;
    });
    assert.deepEqual(
      await readTurnExecutionLogs({
        sessionDir,
        dialogProcessId: "turn-1",
        storageService: TEST_STORAGE_SERVICE,
      }),
      [logs[0]],
    );

    await append(sessionDir, logs.slice(1));
    assert.deepEqual(
      await readTurnExecutionLogs({
        sessionDir,
        dialogProcessId: "turn-1",
        storageService: TEST_STORAGE_SERVICE,
      }),
      [logs[0], logs[2]],
    );
  });
});

test("index publication failure reports all source bytes durable across segment rollover", async () => {
  await withTemp(async (sessionDir) => {
    const failure = new Error("final turn index publication failed");
    const storage = Object.assign(Object.create(TEST_STORAGE_SERVICE), {
      async writeJsonAtomic(file, value) {
        if (value.segments?.length) throw failure;
        return TEST_STORAGE_SERVICE.writeJsonAtomic(file, value);
      },
    });
    const logs = [record(1), record(2)];
    await assert.rejects(append(sessionDir, logs, storage, 1), (error) => {
      assert.equal(error.commitState, "committed");
      assert.equal(error.cause, failure);
      assert.deepEqual(error.append.outcomes, ["written", "written"]);
      return true;
    });
    const directory = resolveExecutionTurnDir(sessionDir, "turn-1");
    for (let index = 0; index < logs.length; index += 1)
      assert.deepEqual(
        JSON.parse(
          await readFile(
            path.join(directory, `segment-${String(index + 1).padStart(6, "0")}.jsonl`),
            "utf8",
          ),
        ),
        logs[index],
      );
  });
});

test("directory sync loss after a segment append marks only its attempted records unknown", async () => {
  await withTemp(async (sessionDir) => {
    await append(sessionDir, [record(0)]);
    const turnDir = resolveExecutionTurnDir(sessionDir, "turn-1");
    const failure = new Error("new segment directory sync lost");
    failure.code = "EEXIST";
    const adapter = getFsAdapter();
    setFsAdapter({
      async syncDirectory(directory) {
        if (directory === turnDir) throw failure;
        return adapter.syncDirectory(directory);
      },
    });
    try {
      await assert.rejects(
        append(sessionDir, [record(1), record(2)], TEST_STORAGE_SERVICE, 1),
        (error) => {
          assert.equal(error.cause, failure);
          assert.equal(error.commitState, "unknown");
          assert.deepEqual(error.append.outcomes, ["unknown", "not_written"]);
          return true;
        },
      );
    } finally {
      resetFsAdapter();
    }
    assert.deepEqual(
      JSON.parse(await readFile(path.join(turnDir, "segment-000002.jsonl"), "utf8")),
      record(1),
    );
    await assert.rejects(readFile(path.join(turnDir, "segment-000003.jsonl")), { code: "ENOENT" });
  });
});

test("repository preserves partial source outcomes and recovers projection without reappend", async () => {
  await withTemp(async (sessionDir) => {
    const failure = new Error("second turn preparation failed");
    const secondIndex = path.join(resolveExecutionTurnDir(sessionDir, "turn-2"), "index.json");
    let interrupted = true;
    const storageService = Object.assign(Object.create(TEST_STORAGE_SERVICE), {
      async writeJsonAtomic(file, value) {
        if (interrupted && file === secondIndex) throw failure;
        return TEST_STORAGE_SERVICE.writeJsonAtomic(file, value);
      },
    });
    const source = new FileSystemExecutionRepository({
      storageService,
      sessionRepository: {
        async withSessionReader(_userId, _sessionId, run) {
          const empty = async () => ({ entries: [], sequence: 0, pending: false });
          return run({
            reader: { readTurnMessageDiagnosticPage: empty, readMessageDiagnosticPage: empty },
            scope: { sessionDir },
          });
        },
        async requireSessionScope() {
          return { sessionDir };
        },
        async withSessionMutation(_userId, _sessionId, write) {
          return write({ sessionDir, resolvedParentSessionId: "" });
        },
      },
    });
    const delivered = [];
    const repository = new ExecutionLogRepository({
      executionRepository: source,
      runtimeEventWriter: async (events) => {
        delivered.push(...events);
        return events.map(() => ({ ok: true }));
      },
    });
    const logs = [record(1), record(2, "turn-2"), record(3)].map((entry) => ({
      ...entry,
      ts: "2026-11-15T00:00:00.000Z",
      data: { id: entry.id },
    }));
    await assert.rejects(repository.appendLogs("u1", "s1", logs), (error) => {
      assert.equal(error.code, "EXECUTION_LOG_APPEND_FAILED");
      assert.equal(error.commitState, "partial");
      assert.equal(error.cause, failure);
      assert.deepEqual(error.append.outcomes, ["written", "not_written", "not_written"]);
      return true;
    });
    assert.equal(delivered.length, 0);
    interrupted = false;
    await repository.appendLogs("u1", "s1", logs.slice(1));
    assert.equal((await source.getTurnLogs("u1", "s1", "turn-1")).length, 2);
    assert.equal((await source.getTurnLogs("u1", "s1", "turn-2")).length, 1);
    assert.equal(delivered.length, 3);
    assert.equal(new Set(delivered.map(({ data }) => data.executionLogSourceId)).size, 3);
    assert.deepEqual(await repository.recoverSessionLogProjection("u1", "s1"), { records: 0 });
    assert.equal(repository.appendQueues.size, 0);
  });
});
