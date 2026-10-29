/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { EXECUTION_EVENT_INDEX_SCHEMA_VERSION } from "@noobot/session-protocol/execution-event-index";

import {
  appendRollingJsonlArtifactLog,
  buildSessionArtifactFileMap,
  readExecutionLogs,
  readTurnExecutionLogs,
} from "../../src/session/session-artifact-store.js";
import { TEST_STORAGE_SERVICE } from "../helpers/storage-service.js";
import {
  TEST_TURN,
  readTurnIndex,
  turnDirOf,
  withTemp,
} from "./session-artifact-store-v2.test-helpers.js";

const SEGMENT_BYTES = LENGTH_THRESHOLDS.artifact.executionEventSegmentBytes;
const storageService = TEST_STORAGE_SERVICE;

function append(sessionDir, log, maxSegmentBytes = SEGMENT_BYTES) {
  return appendRollingJsonlArtifactLog({
    storageService,
    sessionDir,
    log,
    maxSegmentBytes,
    alreadyLocked: false,
  });
}

const readAll = (sessionDir) => readExecutionLogs({ storageService, sessionDir });
const readTurn = (sessionDir, dialogProcessId) =>
  readTurnExecutionLogs({ storageService, sessionDir, dialogProcessId });

async function readSessionIndex(root) {
  return JSON.parse(
    await readFile(
      path.join(buildSessionArtifactFileMap(root).executionEventsDir, "index.json"),
      "utf8",
    ),
  );
}

test("execution events roll by UTF-8 byte size and preserve order", async () =>
  withTemp(async (root) => {
    await append(root, { id: 1, text: "中文", dialogProcessId: TEST_TURN }, 25);
    await append(root, { id: 2, text: "中文", dialogProcessId: TEST_TURN }, 25);
    const index = await readTurnIndex(root, TEST_TURN);
    assert.deepEqual(Object.keys(index).sort(), ["schemaVersion", "segments"]);
    assert.equal(index.schemaVersion, EXECUTION_EVENT_INDEX_SCHEMA_VERSION);
    assert.equal(index.segments.length, 2);
    assert.equal(index.segments[0].sealed, true);
    assert.deepEqual(await readAll(root), [
      { id: 1, text: "中文", dialogProcessId: TEST_TURN },
      { id: 2, text: "中文", dialogProcessId: TEST_TURN },
    ]);
  }));

test("execution events are partitioned by dialogProcessId and read per turn", async () =>
  withTemp(async (root) => {
    for (const log of [
      { id: 1, dialogProcessId: "d1" },
      { id: 2, dialogProcessId: "d2" },
      { id: 3, dialogProcessId: "d1" },
      { id: 4, dialogProcessId: "d2" },
    ]) {
      await append(root, log);
    }
    const sessionIndex = await readSessionIndex(root);
    assert.equal(sessionIndex.schemaVersion, EXECUTION_EVENT_INDEX_SCHEMA_VERSION);
    assert.deepEqual(sessionIndex.turns, [{ dialogProcessId: "d1" }, { dialogProcessId: "d2" }]);
    const ids = (logs) => logs.map((log) => log.id);
    assert.deepEqual(ids(await readTurn(root, "d1")), [1, 3]);
    assert.deepEqual(ids(await readTurn(root, "d2")), [2, 4]);
    assert.deepEqual(ids(await readTurn(root, "missing")), []);
    assert.deepEqual(ids(await readAll(root)), [1, 3, 2, 4]);
  }));

for (const [label, log] of [
  ["unsafe", { id: 1, dialogProcessId: "../escape/turn" }],
  ["missing", { id: 1 }],
  ["data-only", { id: 1, data: { dialogProcessId: "d1" } }],
]) {
  test(`execution append rejects ${label} top-level dialogProcessId`, async () =>
    withTemp(async (root) => {
      await assert.rejects(append(root, log), { code: "DIALOG_PROCESS_ID_INVALID" });
      assert.deepEqual(await readAll(root), []);
    }));
}

test("execution turn reads reject an unsafe dialogProcessId", async () =>
  withTemp(async (root) => {
    await assert.rejects(readTurn(root, "../escape/turn"), { code: "DIALOG_PROCESS_ID_INVALID" });
  }));

test("execution event reader streams records in order across segments and turns", async () =>
  withTemp(async (root) => {
    for (let id = 0; id < 12; id += 1) {
      await append(
        root,
        { id, text: `event-${id}`, dialogProcessId: id < 6 ? "turn-a" : "turn-b" },
        120,
      );
    }
    assert.equal((await readTurnIndex(root, "turn-a")).segments.length > 1, true);
    const ids = (logs) => logs.map((log) => log.id);
    assert.deepEqual(ids(await readAll(root)), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    assert.deepEqual(ids(await readTurn(root, "turn-b")), [6, 7, 8, 9, 10, 11]);
  }));

test("concurrent appends keep a valid index", async () =>
  withTemp(async (root) => {
    await Promise.all(
      Array.from({ length: 20 }, (_, id) =>
        append(root, { id, dialogProcessId: id % 2 ? "odd" : "even" }, 80),
      ),
    );
    assert.equal((await readAll(root)).length, 20);
    assert.equal((await readTurn(root, "odd")).length, 10);
    const sessionIndex = await readSessionIndex(root);
    assert.deepEqual(sessionIndex.turns.map((turn) => turn.dialogProcessId).sort(), [
      "even",
      "odd",
    ]);
    let records = 0;
    for (const key of ["even", "odd"]) {
      const turnIndex = await readTurnIndex(root, key);
      records += turnIndex.segments.reduce((sum, segment) => sum + segment.records, 0);
    }
    assert.equal(records, 20);
  }));

test("execution append repairs stale index counters before writing", async () =>
  withTemp(async (root) => {
    await append(root, { id: 1, dialogProcessId: TEST_TURN });
    const indexPath = path.join(turnDirOf(root, TEST_TURN), "index.json");
    const index = JSON.parse(await readFile(indexPath, "utf8"));
    index.segments[0].bytes = 0;
    index.segments[0].records = 0;
    await writeFile(indexPath, JSON.stringify(index), "utf8");

    await append(root, { id: 2, dialogProcessId: TEST_TURN });

    assert.deepEqual(await readAll(root), [
      { id: 1, dialogProcessId: TEST_TURN },
      { id: 2, dialogProcessId: TEST_TURN },
    ]);
    const repairedIndex = JSON.parse(await readFile(indexPath, "utf8"));
    assert.equal(repairedIndex.segments[0].records, 2);
  }));

test("an oversized execution event stays whole in its own segment", async () =>
  withTemp(async (root) => {
    await append(root, { text: "x".repeat(100), dialogProcessId: TEST_TURN }, 20);
    const index = await readTurnIndex(root, TEST_TURN);
    assert.equal(index.segments.length, 1);
    assert.equal(index.segments[0].oversized, true);
    assert.equal((await readAll(root))[0].text.length, 100);
  }));

test("execution event readers report corrupted indexes, missing segments, and invalid JSONL", async () =>
  withTemp(async (root) => {
    const files = buildSessionArtifactFileMap(root);
    const sessionIndexPath = path.join(files.executionEventsDir, "index.json");
    const turnIndexPath = path.join(turnDirOf(root, TEST_TURN), "index.json");
    const corrupted = { code: "EXECUTION_EVENT_INDEX_CORRUPTED" };
    const writeJson = (filePath, value) => writeFile(filePath, JSON.stringify(value), "utf8");
    const schemaVersion = EXECUTION_EVENT_INDEX_SCHEMA_VERSION;
    await mkdir(files.executionEventsDir, { recursive: true });

    await writeFile(sessionIndexPath, "{broken", "utf8");
    await assert.rejects(readAll(root), corrupted);

    await writeJson(sessionIndexPath, { schemaVersion, turns: [{ dialogProcessId: "../escape" }] });
    await assert.rejects(readAll(root), corrupted);

    await writeJson(sessionIndexPath, { schemaVersion, turns: [{ dialogProcessId: "" }] });
    await assert.rejects(readAll(root), corrupted);

    await writeJson(sessionIndexPath, { schemaVersion, turns: [{ dialogProcessId: TEST_TURN }] });
    await assert.rejects(readAll(root), corrupted);

    await mkdir(turnDirOf(root, TEST_TURN), { recursive: true });
    await writeFile(turnIndexPath, "{broken", "utf8");
    await assert.rejects(readAll(root), corrupted);

    await writeJson(turnIndexPath, { schemaVersion, segments: [{ file: "segment-000001.jsonl" }] });
    await assert.rejects(readAll(root), corrupted);

    await writeJson(turnIndexPath, {
      schemaVersion,
      segments: [
        { sequence: 1, file: "segment-000001.jsonl", bytes: 0, records: 0, sealed: false },
      ],
    });
    await assert.rejects(readAll(root), { code: "EXECUTION_EVENT_SEGMENT_MISSING" });

    await writeFile(path.join(turnDirOf(root, TEST_TURN), "segment-000001.jsonl"), "{broken\n");
    await assert.rejects(readAll(root), { code: "EXECUTION_EVENT_JSONL_CORRUPTED" });
  }));

test("execution events reject a v2 index without creating turn directories", async () =>
  withTemp(async (root) => {
    const files = buildSessionArtifactFileMap(root);
    await mkdir(files.executionEventsDir, { recursive: true });
    await writeFile(
      path.join(files.executionEventsDir, "index.json"),
      JSON.stringify({ schemaVersion: 2, turns: [] }),
      "utf8",
    );
    const unsupported = { code: "EXECUTION_EVENT_INDEX_SCHEMA_UNSUPPORTED" };
    await assert.rejects(readAll(root), unsupported);
    await assert.rejects(append(root, { id: 1, dialogProcessId: TEST_TURN }), unsupported);
    assert.deepEqual(await readdir(files.executionEventsDir), ["index.json"]);
  }));

test("execution append requires storageService and sessionDir", async () => {
  const input = { log: { id: 1 }, maxSegmentBytes: SEGMENT_BYTES, alreadyLocked: false };
  await assert.rejects(appendRollingJsonlArtifactLog({ ...input, sessionDir: "x" }), {
    message: /requires storageService/,
  });
  await assert.rejects(
    appendRollingJsonlArtifactLog({ ...input, storageService, sessionDir: "" }),
    {
      message: /requires sessionDir/,
    },
  );
  await assert.rejects(appendRollingJsonlArtifactLog({ ...input, storageService }), {
    message: /requires sessionDir/,
  });
});
