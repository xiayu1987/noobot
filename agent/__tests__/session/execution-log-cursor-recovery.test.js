/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { EXECUTION_LOG_PROJECTION_CURSOR_FILE } from "@noobot/session-protocol";
import { ExecutionLogRepository } from "../../src/observability/execution-log/execution-log-repository.js";
import { FileSystemExecutionRepository } from "../../src/session/repositories/file-system-execution-repository.js";
import { TEST_STORAGE_SERVICE } from "../helpers/storage-service.js";
import { turnDirOf, withTemp } from "./session-artifact-store-v2.test-helpers.js";

function sourceFor(sessionDir) {
  return new FileSystemExecutionRepository({
    storageService: TEST_STORAGE_SERVICE,
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
  });
}

const record = {
  dialogProcessId: "turn-1",
  event: "cursor_failure",
  ts: "2026-11-15T00:00:00.000Z",
  data: { sequence: 1 },
};

test("lost cursor publication reports committed source and replays identical identities without reappend", async () => {
  await withTemp(async (sessionDir) => {
    const cursor = path.join(
      turnDirOf(sessionDir, record.dialogProcessId),
      EXECUTION_LOG_PROJECTION_CURSOR_FILE,
    );
    const delivered = [];
    const source = sourceFor(sessionDir);
    let obstruct = true;
    const repository = new ExecutionLogRepository({
      executionRepository: source,
      runtimeEventWriter: async (events) => {
        delivered.push(...events);
        if (obstruct) await mkdir(cursor);
        return events.map(() => ({ ok: true }));
      },
    });
    await assert.rejects(repository.appendLogs("u1", "s1", [record]), (error) => {
      assert.equal(error.code, "EXECUTION_LOG_PROJECTION_FAILED");
      assert.equal(error.commitState, "committed");
      assert.deepEqual(error.projection.outcomes, ["written"]);
      assert.ok(error.cause);
      return true;
    });
    assert.equal((await source.getTurnLogs("u1", "s1", record.dialogProcessId)).length, 1);
    assert.equal(repository.appendQueues.size, 0);
    await rm(cursor, { recursive: true });
    obstruct = false;
    const restarted = new ExecutionLogRepository({
      executionRepository: sourceFor(sessionDir),
      runtimeEventWriter: repository.runtimeEventWriter,
    });
    assert.deepEqual(await restarted.recoverSessionLogProjection("u1", "s1"), { records: 1 });
    assert.deepEqual(await restarted.recoverSessionLogProjection("u1", "s1"), { records: 0 });
    assert.equal(delivered.length, 2);
    assert.equal(delivered[0].data.executionLogSourceId, delivered[1].data.executionLogSourceId);
    assert.equal((await source.getTurnLogs("u1", "s1", record.dialogProcessId)).length, 1);
    const checkpoint = JSON.parse(await readFile(cursor, "utf8"));
    assert.equal(checkpoint.sequence, 1);
    assert.ok(checkpoint.offset > 0);
  });
});

test("delivery completion precedes cursor publication and failed delivery never advances it", async () => {
  await withTemp(async (sessionDir) => {
    const source = sourceFor(sessionDir);
    await source.appendLogs("u1", "s1", [record]);
    const cursor = path.join(
      turnDirOf(sessionDir, record.dialogProcessId),
      EXECUTION_LOG_PROJECTION_CURSOR_FILE,
    );
    const reached = Promise.withResolvers();
    const finish = Promise.withResolvers();
    const recovery = source.projectPendingLogs("u1", "s1", {
      dialogProcessIds: [record.dialogProcessId],
      deliver: async (entries) => {
        reached.resolve();
        await finish.promise;
        return entries.map(() => "written");
      },
    });
    await reached.promise;
    await assert.rejects(readFile(cursor), { code: "ENOENT" });
    finish.resolve();
    await recovery;
    const checkpoint = await readFile(cursor, "utf8");
    await source.appendLogs("u1", "s1", [{ ...record, data: { sequence: 2 } }]);
    const failure = new Error("delivery not durably confirmed");
    await assert.rejects(
      source.projectPendingLogs("u1", "s1", {
        dialogProcessIds: [record.dialogProcessId],
        deliver: async () => {
          throw failure;
        },
      }),
      (error) => error === failure,
    );
    assert.equal(await readFile(cursor, "utf8"), checkpoint);
  });
});

test("cursor publication failure preserves mixed written and skipped outcomes", async () => {
  await withTemp(async (sessionDir) => {
    const cursor = path.join(
      turnDirOf(sessionDir, record.dialogProcessId),
      EXECUTION_LOG_PROJECTION_CURSOR_FILE,
    );
    const repository = new ExecutionLogRepository({
      executionRepository: sourceFor(sessionDir),
      runtimeEventWriter: async () => {
        await mkdir(cursor);
        return [{ ok: true }, { ok: true, skipped: true }];
      },
    });
    await assert.rejects(
      repository.appendLogs("u1", "s1", [record, { ...record, data: { sequence: 2 } }]),
      (error) => {
        assert.equal(error.commitState, "committed");
        assert.deepEqual(error.projection.outcomes, ["written", "skipped"]);
        assert.equal(error.projection.records.length, 2);
        return true;
      },
    );
    assert.equal((await repository.getTurnLogs("u1", "s1", record.dialogProcessId)).length, 2);
  });
});

test("invalid delivery receipts cannot acknowledge source records", async () => {
  await withTemp(async (sessionDir) => {
    const source = sourceFor(sessionDir);
    await source.appendLogs("u1", "s1", [record]);
    const cursor = path.join(
      turnDirOf(sessionDir, record.dialogProcessId),
      EXECUTION_LOG_PROJECTION_CURSOR_FILE,
    );
    for (const outcomes of [undefined, [], Array(1), ["unknown"], ["failed"]]) {
      await assert.rejects(
        source.projectPendingLogs("u1", "s1", {
          dialogProcessIds: [record.dialogProcessId],
          deliver: async () => outcomes,
        }),
        TypeError,
      );
      await assert.rejects(readFile(cursor), { code: "ENOENT" });
    }
    assert.deepEqual(
      await source.projectPendingLogs("u1", "s1", {
        dialogProcessIds: [record.dialogProcessId],
        deliver: async () => ["skipped"],
      }),
      { records: 1 },
    );
  });
});
