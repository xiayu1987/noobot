/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  appendRollingJsonlArtifactLog,
  buildSessionArtifactFileMap,
  readExecutionLogs,
} from "../../src/session/session-artifact-store.js";
import {
  TEST_TURN,
  readTurnIndex,
  turnDirOf,
  withTemp,
} from "./session-artifact-store-v2.test-helpers.js";

test("execution events roll by UTF-8 byte size and preserve order", async () =>
  withTemp(async (root) => {
    await appendRollingJsonlArtifactLog({
      sessionDir: root,
      log: { id: 1, text: "中文", dialogProcessId: TEST_TURN },
      maxSegmentBytes: 25,
    });
    await appendRollingJsonlArtifactLog({
      sessionDir: root,
      log: { id: 2, text: "中文", dialogProcessId: TEST_TURN },
      maxSegmentBytes: 25,
    });
    const index = await readTurnIndex(root, TEST_TURN);
    assert.equal(index.segments.length, 2);
    assert.equal(index.segments[0].sealed, true);
    assert.deepEqual(await readExecutionLogs(root), [
      { id: 1, text: "中文", dialogProcessId: TEST_TURN },
      { id: 2, text: "中文", dialogProcessId: TEST_TURN },
    ]);
  }));

test("execution events are partitioned by dialogProcessId and read per turn", async () =>
  withTemp(async (root) => {
    const logs = [
      { id: 1, dialogProcessId: "d1" },
      { id: 2, dialogProcessId: "d2" },
      { id: 3, dialogProcessId: "d1" },
      { id: 4, dialogProcessId: "d2" },
    ];
    for (const log of logs) await appendRollingJsonlArtifactLog({ sessionDir: root, log });
    const sessionIndex = JSON.parse(
      await readFile(
        path.join(buildSessionArtifactFileMap(root).executionEventsDir, "index.json"),
        "utf8",
      ),
    );
    assert.deepEqual(sessionIndex.turns, [{ dialogProcessId: "d1" }, { dialogProcessId: "d2" }]);
    const ids = async (options) => (await readExecutionLogs(root, options)).map((log) => log.id);
    assert.deepEqual(await ids({ dialogProcessId: "d1" }), [1, 3]);
    assert.deepEqual(await ids({ dialogProcessId: "d2" }), [2, 4]);
    assert.deepEqual(await ids({ dialogProcessId: "missing" }), []);
    assert.deepEqual(await ids(), [1, 3, 2, 4]);
  }));

for (const [label, log] of [
  ["unsafe", { id: 1, dialogProcessId: "../escape/turn" }],
  ["missing", { id: 1 }],
  ["data-only", { id: 1, data: { dialogProcessId: "d1" } }],
]) {
  test(`execution append rejects ${label} top-level dialogProcessId`, async () =>
    withTemp(async (root) => {
      await assert.rejects(appendRollingJsonlArtifactLog({ sessionDir: root, log }), {
        code: "DIALOG_PROCESS_ID_INVALID",
      });
      assert.deepEqual(await readExecutionLogs(root), []);
    }));
}

test("execution turn reads reject an unsafe dialogProcessId", async () =>
  withTemp(async (root) => {
    await assert.rejects(readExecutionLogs(root, { dialogProcessId: "../escape/turn" }), {
      code: "DIALOG_PROCESS_ID_INVALID",
    });
  }));

test("execution event reader streams records in order across segments and turns", async () =>
  withTemp(async (root) => {
    for (let id = 0; id < 12; id += 1) {
      await appendRollingJsonlArtifactLog({
        sessionDir: root,
        log: { id, text: `event-${id}`, dialogProcessId: id < 6 ? "turn-a" : "turn-b" },
        maxSegmentBytes: 120,
      });
    }
    assert.equal((await readTurnIndex(root, "turn-a")).segments.length > 1, true);
    const ids = async (options) => (await readExecutionLogs(root, options)).map((l) => l.id);
    assert.deepEqual(await ids(), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    assert.deepEqual(await ids({ dialogProcessId: "turn-b" }), [6, 7, 8, 9, 10, 11]);
  }));

test("concurrent appends keep a valid index", async () =>
  withTemp(async (root) => {
    await Promise.all(
      Array.from({ length: 20 }, (_, id) =>
        appendRollingJsonlArtifactLog({
          sessionDir: root,
          log: { id, dialogProcessId: id % 2 ? "odd" : "even" },
          maxSegmentBytes: 80,
        }),
      ),
    );
    assert.equal((await readExecutionLogs(root)).length, 20);
    assert.equal((await readExecutionLogs(root, { dialogProcessId: "odd" })).length, 10);
    const sessionIndex = JSON.parse(
      await readFile(
        path.join(buildSessionArtifactFileMap(root).executionEventsDir, "index.json"),
        "utf8",
      ),
    );
    assert.deepEqual(sessionIndex.turns.map((turn) => turn.dialogProcessId).sort(), [
      "even",
      "odd",
    ]);
    let records = 0;
    for (const key of ["even", "odd"]) {
      const turnIndex = await readTurnIndex(root, key);
      assert.equal(turnIndex.dialogProcessId, key);
      records += turnIndex.segments.reduce((sum, segment) => sum + segment.records, 0);
    }
    assert.equal(records, 20);
  }));

test("execution append repairs stale index counters before writing", async () =>
  withTemp(async (root) => {
    await appendRollingJsonlArtifactLog({
      sessionDir: root,
      log: { id: 1, dialogProcessId: TEST_TURN },
    });
    const indexPath = path.join(turnDirOf(root, TEST_TURN), "index.json");
    const index = JSON.parse(await readFile(indexPath, "utf8"));
    index.segments[0].bytes = 0;
    index.segments[0].records = 0;
    await writeFile(indexPath, JSON.stringify(index), "utf8");

    await appendRollingJsonlArtifactLog({
      sessionDir: root,
      log: { id: 2, dialogProcessId: TEST_TURN },
    });

    assert.deepEqual(await readExecutionLogs(root), [
      { id: 1, dialogProcessId: TEST_TURN },
      { id: 2, dialogProcessId: TEST_TURN },
    ]);
    const repairedIndex = JSON.parse(await readFile(indexPath, "utf8"));
    assert.equal(repairedIndex.segments[0].records, 2);
  }));

test("an oversized execution event stays whole in its own segment", async () =>
  withTemp(async (root) => {
    await appendRollingJsonlArtifactLog({
      sessionDir: root,
      log: { text: "x".repeat(100), dialogProcessId: TEST_TURN },
      maxSegmentBytes: 20,
    });
    const index = await readTurnIndex(root, TEST_TURN);
    assert.equal(index.segments.length, 1);
    assert.equal(index.segments[0].oversized, true);
    assert.equal((await readExecutionLogs(root))[0].text.length, 100);
  }));

test("execution event readers report corrupted indexes, missing segments, and invalid JSONL", async () =>
  withTemp(async (root) => {
    const files = buildSessionArtifactFileMap(root);
    await mkdir(files.executionEventsDir, { recursive: true });

    await writeFile(path.join(files.executionEventsDir, "index.json"), "{broken", "utf8");
    await assert.rejects(readExecutionLogs(root), { code: "EXECUTION_EVENT_INDEX_CORRUPTED" });

    await writeFile(
      path.join(files.executionEventsDir, "index.json"),
      JSON.stringify({ turns: [{ dialogProcessId: "../escape" }] }),
      "utf8",
    );
    await assert.rejects(readExecutionLogs(root), { code: "EXECUTION_EVENT_INDEX_CORRUPTED" });

    await writeFile(
      path.join(files.executionEventsDir, "index.json"),
      JSON.stringify({ turns: [{ dialogProcessId: "" }] }),
      "utf8",
    );
    await assert.rejects(readExecutionLogs(root), { code: "EXECUTION_EVENT_INDEX_CORRUPTED" });

    await writeFile(
      path.join(files.executionEventsDir, "index.json"),
      JSON.stringify({ turns: [{ dialogProcessId: TEST_TURN }] }),
      "utf8",
    );
    await mkdir(turnDirOf(root, TEST_TURN), { recursive: true });
    await writeFile(path.join(turnDirOf(root, TEST_TURN), "index.json"), "{broken", "utf8");
    await assert.rejects(readExecutionLogs(root), { code: "EXECUTION_EVENT_INDEX_CORRUPTED" });

    await writeFile(
      path.join(turnDirOf(root, TEST_TURN), "index.json"),
      JSON.stringify({ segments: [{ file: "segment-000001.jsonl" }] }),
      "utf8",
    );
    await assert.rejects(readExecutionLogs(root), { code: "EXECUTION_EVENT_SEGMENT_MISSING" });

    await writeFile(
      path.join(turnDirOf(root, TEST_TURN), "segment-000001.jsonl"),
      "{broken\n",
      "utf8",
    );
    await assert.rejects(readExecutionLogs(root), { code: "EXECUTION_EVENT_JSONL_CORRUPTED" });
  }));

test("execution append rejects an empty sessionDir", async () => {
  await assert.rejects(appendRollingJsonlArtifactLog({ sessionDir: "", log: { id: 1 } }), {
    message: /requires sessionDir/,
  });
  await assert.rejects(appendRollingJsonlArtifactLog({ log: { id: 1 } }), {
    message: /requires sessionDir/,
  });
});
