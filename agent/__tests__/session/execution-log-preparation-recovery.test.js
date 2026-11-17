/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createSessionExecutionIndex } from "@noobot/session-protocol/execution-event-index";
import {
  appendRollingJsonlArtifactLogs,
  resolveExecutionEventsDir,
  readExecutionTurnIndex,
} from "../../src/session/session-artifact-execution-logs.js";
import { recoverExecutionLogIndexes } from "../../src/session/execution-log-recovery.js";
import { TEST_STORAGE_SERVICE } from "../helpers/storage-service.js";
import { turnDirOf, withTemp } from "./session-artifact-store-v2.test-helpers.js";

const logs = [{ dialogProcessId: "turn-1", event: "preparation", ts: "2026-11-15T00:00:00.000Z" }];

function rejectingPreparation(failure) {
  return Object.assign(Object.create(TEST_STORAGE_SERVICE), {
    async writeJsonAtomic(file, value) {
      if (value.segments?.length === 0) throw failure;
      return TEST_STORAGE_SERVICE.writeJsonAtomic(file, value);
    },
  });
}

async function interruptedPreparation(sessionDir) {
  const failure = new Error("empty index publication interrupted");
  await assert.rejects(
    appendRollingJsonlArtifactLogs({
      storageService: rejectingPreparation(failure),
      sessionDir,
      logs,
      maxSegmentBytes: 4096,
      alreadyLocked: false,
    }),
    (error) => error === failure,
  );
  const turnDir = turnDirOf(sessionDir, "turn-1");
  assert.deepEqual(await readdir(turnDir), []);
  return turnDir;
}

test("restart completes interrupted source-free preparation and a later append succeeds once", async () => {
  await withTemp(async (sessionDir) => {
    const turnDir = await interruptedPreparation(sessionDir);
    const options = { storageService: TEST_STORAGE_SERVICE, sessionDir };
    const result = await recoverExecutionLogIndexes(options);
    assert.deepEqual(result.dialogProcessIds, ["turn-1"]);
    assert.deepEqual((await readExecutionTurnIndex({ ...options, turnDir })).segments, []);
    assert.deepEqual((await recoverExecutionLogIndexes(options)).repaired, []);
    await appendRollingJsonlArtifactLogs({
      ...options,
      logs,
      maxSegmentBytes: 4096,
      alreadyLocked: false,
    });
    const index = await readExecutionTurnIndex({ ...options, turnDir });
    assert.equal(index.segments[0].records, 1);
    const bytes = await readFile(path.join(turnDir, index.segments[0].file));
    await recoverExecutionLogIndexes(options);
    assert.deepEqual(await readFile(path.join(turnDir, index.segments[0].file)), bytes);
  });
});

test("preparation recovery publication failure leaves retryable state and preserves cause", async () => {
  await withTemp(async (sessionDir) => {
    const turnDir = await interruptedPreparation(sessionDir);
    const failure = new Error("recovery publication interrupted");
    await assert.rejects(
      recoverExecutionLogIndexes({
        storageService: rejectingPreparation(failure),
        sessionDir,
      }),
      (error) => error === failure,
    );
    assert.deepEqual(await readdir(turnDir), []);
    await recoverExecutionLogIndexes({ storageService: TEST_STORAGE_SERVICE, sessionDir });
  });
});

test("missing unregistered index with source bytes is rejected before any index publication", async () => {
  await withTemp(async (sessionDir) => {
    const turnDir = await interruptedPreparation(sessionDir);
    const source = path.join(turnDir, "segment-000001.jsonl");
    const bytes = Buffer.from(`${JSON.stringify(logs[0])}\n`);
    await writeFile(source, bytes);
    await assert.rejects(
      recoverExecutionLogIndexes({ storageService: TEST_STORAGE_SERVICE, sessionDir }),
    );
    assert.deepEqual(await readdir(turnDir), ["segment-000001.jsonl"]);
    assert.deepEqual(await readFile(source), bytes);
  });
});

test("registered missing index remains corrupt even when its directory is empty", async () => {
  await withTemp(async (sessionDir) => {
    const turnDir = turnDirOf(sessionDir, "turn-1");
    await mkdir(turnDir, { recursive: true });
    await TEST_STORAGE_SERVICE.writeJsonAtomic(
      path.join(resolveExecutionEventsDir(sessionDir), "index.json"),
      createSessionExecutionIndex([{ dialogProcessId: "turn-1" }]),
    );
    await assert.rejects(
      recoverExecutionLogIndexes({ storageService: TEST_STORAGE_SERVICE, sessionDir }),
      { code: "EXECUTION_EVENT_INDEX_CORRUPTED" },
    );
    assert.deepEqual(await readdir(turnDir), []);
  });
});
