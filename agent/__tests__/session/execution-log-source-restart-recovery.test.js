/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createSessionExecutionIndex } from "@noobot/session-protocol/execution-event-index";
import { ExecutionLogRepository } from "../../src/observability/execution-log/execution-log-repository.js";
import { FileSystemExecutionRepository } from "../../src/session/repositories/file-system-execution-repository.js";
import { resolveExecutionEventsDir } from "../../src/session/session-artifact-execution-logs.js";
import { TEST_STORAGE_SERVICE } from "../helpers/storage-service.js";
import { turnDirOf, withTemp } from "./session-artifact-store-v2.test-helpers.js";

const record = (sequence) => ({
  dialogProcessId: "turn-1",
  event: "source_restart",
  ts: "2026-11-15T00:00:00.000Z",
  data: { sequence },
});

function repositoryFor(sessionDir, delivered, storageService = TEST_STORAGE_SERVICE) {
  return new ExecutionLogRepository({
    executionRepository: new FileSystemExecutionRepository({
      storageService,
      sessionRepository: {
        async withSessionReader(_userId, _sessionId, run) {
          const empty = async () => ({ entries: [], sequence: 0, pending: false });
          return run(
            { readTurnMessageDiagnosticPage: empty, readMessageDiagnosticPage: empty },
            { sessionDir },
          );
        },
        async withSessionMutation(_userId, _sessionId, write) {
          return write({ sessionDir, resolvedParentSessionId: "" });
        },
        async requireSessionScope() {
          return { sessionDir };
        },
      },
    }),
    runtimeEventWriter: async (events) => {
      delivered.push(...events);
      return events.map(() => ({ ok: true }));
    },
  });
}

for (const existing of [false, true]) {
  test(`restart recovers unpublished source index with existing=${existing} without reappend`, async () => {
    await withTemp(async (sessionDir) => {
      const delivered = [];
      if (existing) await repositoryFor(sessionDir, delivered).appendLogs("u1", "s1", [record(0)]);
      const failure = new Error("source index publication interrupted");
      const storage = Object.assign(Object.create(TEST_STORAGE_SERVICE), {
        async writeJsonAtomic(file, value) {
          if (value.segments?.length) throw failure;
          return TEST_STORAGE_SERVICE.writeJsonAtomic(file, value);
        },
      });
      await assert.rejects(
        repositoryFor(sessionDir, delivered, storage).appendLogs("u1", "s1", [record(1)]),
        (error) => error.commitState === "committed" && error.cause === failure,
      );
      const segment = path.join(turnDirOf(sessionDir, "turn-1"), "segment-000001.jsonl");
      const bytes = await readFile(segment);
      const restarted = repositoryFor(sessionDir, delivered);
      assert.deepEqual(await restarted.recoverSessionLogProjection("u1", "s1"), { records: 1 });
      assert.deepEqual(await readFile(segment), bytes);
      assert.deepEqual(await restarted.recoverSessionLogProjection("u1", "s1"), { records: 0 });
      assert.equal(delivered.length, existing ? 2 : 1);
      assert.equal(
        new Set(delivered.map(({ data }) => data.executionLogSourceId)).size,
        delivered.length,
      );
      assert.equal((await restarted.getTurnLogs("u1", "s1", "turn-1")).length, delivered.length);
    });
  });
}

test("restart discovers unregistered turns through the same validated recovery", async () => {
  await withTemp(async (sessionDir) => {
    const delivered = [];
    const original = repositoryFor(sessionDir, delivered);
    await original.executionRepository.appendLogs("u1", "s1", [record(1)]);
    await TEST_STORAGE_SERVICE.writeJsonAtomic(
      path.join(resolveExecutionEventsDir(sessionDir), "index.json"),
      createSessionExecutionIndex([]),
    );
    const restarted = repositoryFor(sessionDir, delivered);
    assert.deepEqual(await restarted.recoverSessionLogProjection("u1", "s1"), { records: 1 });
    assert.deepEqual(await restarted.recoverSessionLogProjection("u1", "s1"), { records: 0 });
    assert.equal(delivered.length, 1);
  });
});

test("restart rejects corrupted unpublished source before delivery or index publication", async () => {
  await withTemp(async (sessionDir) => {
    const delivered = [];
    const original = repositoryFor(sessionDir, delivered);
    await original.executionRepository.appendLogs("u1", "s1", [record(1)]);
    const turnDir = turnDirOf(sessionDir, "turn-1");
    const indexPath = path.join(turnDir, "index.json");
    const index = await readFile(indexPath);
    await writeFile(path.join(turnDir, "segment-000002.jsonl"), '{"broken":');
    await assert.rejects(
      repositoryFor(sessionDir, delivered).recoverSessionLogProjection("u1", "s1"),
    );
    assert.equal(delivered.length, 0);
    assert.deepEqual(await readFile(indexPath), index);
  });
});

test("failed recovery publication propagates its error and a new recovery completes once", async () => {
  await withTemp(async (sessionDir) => {
    const delivered = [];
    const failure = new Error("index storage unavailable");
    const storage = Object.assign(Object.create(TEST_STORAGE_SERVICE), {
      async writeJsonAtomic(file, value) {
        if (value.segments?.length) throw failure;
        return TEST_STORAGE_SERVICE.writeJsonAtomic(file, value);
      },
    });
    const interrupted = repositoryFor(sessionDir, delivered, storage);
    await assert.rejects(interrupted.appendLogs("u1", "s1", [record(1)]));
    await assert.rejects(
      interrupted.recoverSessionLogProjection("u1", "s1"),
      (error) => error === failure,
    );
    assert.equal(delivered.length, 0);
    assert.equal(interrupted.appendQueues.size, 0);
    const restarted = repositoryFor(sessionDir, delivered);
    assert.deepEqual(await restarted.recoverSessionLogProjection("u1", "s1"), { records: 1 });
    assert.deepEqual(await restarted.recoverSessionLogProjection("u1", "s1"), { records: 0 });
    assert.equal(delivered.length, 1);
  });
});
