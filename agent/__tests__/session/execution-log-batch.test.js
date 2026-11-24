/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { access } from "node:fs/promises";
import {
  EXECUTION_LOG_BATCH_MAX_RECORDS,
  executionLogByteBudget,
  encodeExecutionSegmentRecord,
  requireExecutionLogBatch,
  prepareExecutionLogRecord,
} from "@noobot/session-protocol";
import {
  appendRollingJsonlArtifactLogs,
  readTurnExecutionLogs,
  resolveExecutionEventsDir,
} from "../../src/session/session-artifact-execution-logs.js";
import { TEST_STORAGE_SERVICE } from "../helpers/storage-service.js";
import { readTurnIndex } from "../helpers/execution-log-fixture.js";
import { withTemp } from "../helpers/temporary-directory.js";

const record = (id, dialogProcessId = "turn-1") => ({ id, dialogProcessId, text: "中文" });

function recordWithBytes(bytes, id = 1) {
  const log = { id, dialogProcessId: "turn-1", text: "" };
  log.text = "x".repeat(bytes - encodeExecutionSegmentRecord(log).bytes);
  return log;
}

test("direct source append rejects an unprojectable record before creating storage", async () => {
  await withTemp(async (sessionDir) => {
    await assert.rejects(
      append(sessionDir, [record(0), recordWithBytes(executionLogByteBudget().batchBytes + 1)]),
      { code: "EXECUTION_LOG_RECORD_TOO_LARGE" },
    );
    await assert.rejects(access(resolveExecutionEventsDir(sessionDir)), { code: "ENOENT" });
  });
});

test("direct source append enforces the complete encoded batch budget before publication", async () => {
  await withTemp(async (sessionDir) => {
    const bytes = Math.floor(executionLogByteBudget().batchBytes / 2) + 1;
    await assert.rejects(
      append(sessionDir, [recordWithBytes(bytes, 1), recordWithBytes(bytes, 2)]),
      {
        code: "EXECUTION_LOG_BATCH_TOO_LARGE",
      },
    );
    await assert.rejects(access(resolveExecutionEventsDir(sessionDir)), { code: "ENOENT" });
  });
});

test("direct source append accepts the exact encoded byte boundary", async () => {
  await withTemp(async (sessionDir) => {
    const log = recordWithBytes(executionLogByteBudget().batchBytes);
    await append(sessionDir, [log]);
    assert.deepEqual(
      await readTurnExecutionLogs({
        storageService: TEST_STORAGE_SERVICE,
        sessionDir,
        dialogProcessId: log.dialogProcessId,
      }),
      [log],
    );
  });
});

test("execution batch serializes each record once before entering its mutation queue", async () => {
  await withTemp(async (sessionDir) => {
    let encodes = 0;
    const logs = Array.from({ length: 4 }, (_, id) => ({
      ...record(id, id === 2 ? "turn-2" : "turn-1"),
      data: {
        toJSON() {
          encodes += 1;
          return { id };
        },
      },
    }));
    await append(sessionDir, logs);
    assert.equal(encodes, logs.length);
    const stored = await readTurnExecutionLogs({
      storageService: TEST_STORAGE_SERVICE,
      sessionDir,
      dialogProcessId: "turn-1",
    });
    assert.deepEqual(
      stored.map(({ data }) => data.id),
      [0, 1, 3],
    );
  });
});
const append = (sessionDir, logs, maxSegmentBytes = 4096, storageService = TEST_STORAGE_SERVICE) =>
  appendRollingJsonlArtifactLogs({
    storageService,
    sessionDir,
    logs,
    maxSegmentBytes,
    alreadyLocked: false,
  });

test("execution batch writes one final turn index and preserves source order", async () => {
  await withTemp(async (sessionDir) => {
    const writes = [];
    const storageService = Object.create(TEST_STORAGE_SERVICE);
    storageService.writeJsonAtomic = async (...args) => {
      writes.push(args[0]);
      return TEST_STORAGE_SERVICE.writeJsonAtomic(...args);
    };
    const logs = Array.from({ length: 20 }, (_, id) => record(id));
    await append(sessionDir, logs, 4096, storageService);
    assert.equal(writes.length, 3);
    assert.equal((await readTurnIndex(sessionDir, "turn-1")).segments[0].records, 20);
    assert.deepEqual(
      await readTurnExecutionLogs({ storageService, sessionDir, dialogProcessId: "turn-1" }),
      logs,
    );
    writes.length = 0;
    await append(sessionDir, [record(20), record(21)], 4096, storageService);
    assert.equal(writes.length, 1);
  });
});

test("execution batch rolls segments and handles interleaved turn ownership", async () => {
  await withTemp(async (sessionDir) => {
    const logs = [record(1), record(2), record(3, "turn-2"), record(4)];
    await append(sessionDir, logs, 90);
    assert.deepEqual(
      await readTurnExecutionLogs({
        storageService: TEST_STORAGE_SERVICE,
        sessionDir,
        dialogProcessId: "turn-1",
      }),
      [logs[0], logs[1], logs[3]],
    );
    const index = await readTurnIndex(sessionDir, "turn-1");
    assert.ok(index.segments.length > 1);
    assert.ok(index.segments.slice(0, -1).every((segment) => segment.sealed));
  });
});

for (const [label, serialized] of [
  ["missing object", undefined],
  ["null", null],
  ["array", []],
  ["scalar", "invalid"],
  ["missing turn", { event: "wrong" }],
  ["different turn", { dialogProcessId: "turn-2" }],
]) {
  test(`encoded execution logs reject ${label} before admission or source publication`, async () => {
    const invalid = { ...record(2), toJSON: () => serialized };
    assert.throws(() => prepareExecutionLogRecord(invalid));
    await withTemp(async (sessionDir) => {
      await assert.rejects(append(sessionDir, [record(1), invalid]));
      await assert.rejects(access(resolveExecutionEventsDir(sessionDir)), { code: "ENOENT" });
    });
  });
}

test("serialized bytes own the route even when a nested hook mutates the input", async () => {
  await withTemp(async (sessionDir) => {
    let encodes = 0;
    const log = record(1);
    log.data = {
      toJSON() {
        encodes += 1;
        log.dialogProcessId = "turn-2";
        return { value: "canonical" };
      },
    };
    await append(sessionDir, [log]);
    assert.equal(encodes, 1);
    assert.deepEqual(
      await readTurnExecutionLogs({
        storageService: TEST_STORAGE_SERVICE,
        sessionDir,
        dialogProcessId: "turn-1",
      }),
      [{ ...record(1), data: { value: "canonical" } }],
    );
    assert.deepEqual(
      await readTurnExecutionLogs({
        storageService: TEST_STORAGE_SERVICE,
        sessionDir,
        dialogProcessId: "turn-2",
      }),
      [],
    );
  });
});

test("execution batch validates every record before creating storage", async () => {
  assert.throws(() => requireExecutionLogBatch([]), TypeError);
  assert.throws(
    () =>
      requireExecutionLogBatch(
        Array.from({ length: EXECUTION_LOG_BATCH_MAX_RECORDS + 1 }, (_, id) => record(id)),
      ),
    TypeError,
  );
  await withTemp(async (sessionDir) => {
    await assert.rejects(append(sessionDir, [record(1), record(2, "../unsafe")]), {
      code: "DIALOG_PROCESS_ID_INVALID",
    });
    const invalid = record(2);
    invalid.self = invalid;
    await assert.rejects(append(sessionDir, [record(1), invalid]), TypeError);
    await assert.rejects(access(resolveExecutionEventsDir(sessionDir)), { code: "ENOENT" });
  });
});
