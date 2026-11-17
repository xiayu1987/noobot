/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { EXECUTION_LOG_PROJECTION_CURSOR_FILE } from "@noobot/session-protocol";
import { projectTurnExecutionLogs } from "../../src/session/execution-log-projection-store.js";
import { createExecutionProjectionReader } from "../../src/session/execution-log-projection-reader.js";
import {
  appendRollingJsonlArtifactLogs,
  readExecutionLogs,
  readExecutionSegmentSummary,
  resolveExecutionTurnDir,
} from "../../src/session/session-artifact-execution-logs.js";
import {
  repairSessionArtifacts,
  inspectSessionArtifacts,
} from "../../src/session/session-artifact-maintenance.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { TEST_STORAGE_SERVICE as storageService } from "../helpers/storage-service.js";
import { withTemp } from "./session-artifact-store-v2.test-helpers.js";

const dialogProcessId = "byte-integrity-turn";
const file = "segment-000001.jsonl";
const record = { dialogProcessId, content: "valid" };
const append = (sessionDir) =>
  appendRollingJsonlArtifactLogs({
    storageService,
    sessionDir,
    logs: [record],
    maxSegmentBytes: 4096,
    alreadyLocked: false,
  });
const corruptedBytes = Buffer.concat([
  Buffer.from(`{"dialogProcessId":"${dialogProcessId}","content":"`),
  Buffer.from([0xc3, 0x28]),
  Buffer.from('"}\n'),
]);

for (const mode of ["invalid UTF-8", "foreign turn"]) {
  test(`read, audit and repair reject ${mode} without rewriting source evidence`, async () => {
    await withTemp(async (sessionDir) => {
      const store = new ImmutableSessionStore({
        sessionDir,
        sessionId: "byte-integrity",
        allowCreate: true,
      });
      await store.commit({ expectedGeneration: 0, operationId: "initial", changes: [] });
      await append(sessionDir);
      const turnDir = resolveExecutionTurnDir(sessionDir, dialogProcessId);
      const segment = path.join(turnDir, file);
      const indexFile = path.join(turnDir, "index.json");
      const indexBefore = await readFile(indexFile);
      const bytes =
        mode === "invalid UTF-8"
          ? corruptedBytes
          : Buffer.from(`${JSON.stringify({ ...record, dialogProcessId: "foreign-turn" })}\n`);
      await writeFile(segment, bytes);
      await assert.rejects(readExecutionLogs({ storageService, sessionDir }), {
        code: "EXECUTION_EVENT_JSONL_CORRUPTED",
      });
      const report = await inspectSessionArtifacts({ storageService, sessionDir });
      assert.equal(report.ok, false);
      assert.equal(report.issues[0].code, "EXECUTION_EVENT_JSONL_CORRUPTED");
      await assert.rejects(
        repairSessionArtifacts({
          storageService,
          sessionDir,
          alreadyLocked: false,
          assertSessionWritable: async () => {},
        }),
        { code: "EXECUTION_EVENT_JSONL_CORRUPTED" },
      );
      assert.deepEqual(await readFile(indexFile), indexBefore);
      assert.deepEqual(await readFile(segment), bytes);
    });
  });

  test(`projection rejects ${mode} before delivery or cursor publication`, async () => {
    await withTemp(async (sessionDir) => {
      await append(sessionDir);
      const turnDir = resolveExecutionTurnDir(sessionDir, dialogProcessId);
      const bytes =
        mode === "invalid UTF-8"
          ? corruptedBytes
          : Buffer.from(`${JSON.stringify({ ...record, dialogProcessId: "foreign-turn" })}\n`);
      await writeFile(path.join(turnDir, file), bytes);
      const indexFile = path.join(turnDir, "index.json");
      const index = JSON.parse(await readFile(indexFile, "utf8"));
      index.segments[0].bytes = bytes.length;
      await storageService.writeJsonAtomic(indexFile, index);
      let delivered = 0;
      await assert.rejects(
        projectTurnExecutionLogs({
          storageService,
          sessionDir,
          dialogProcessId,
          readProjectionBatches: createExecutionProjectionReader(),
          deliver: async () => {
            delivered += 1;
          },
        }),
        { code: "EXECUTION_EVENT_JSONL_CORRUPTED" },
      );
      assert.equal(delivered, 0);
      await assert.rejects(readFile(path.join(turnDir, EXECUTION_LOG_PROJECTION_CURSOR_FILE)), {
        code: "ENOENT",
      });
      assert.deepEqual(await readFile(path.join(turnDir, file)), bytes);
    });
  });

  test(`active segment reconciliation refuses ${mode} before appending new bytes`, async () => {
    await withTemp(async (sessionDir) => {
      await append(sessionDir);
      const turnDir = resolveExecutionTurnDir(sessionDir, dialogProcessId);
      const segment = path.join(turnDir, file);
      const indexFile = path.join(turnDir, "index.json");
      const indexBefore = await readFile(indexFile);
      await appendFile(
        segment,
        mode === "invalid UTF-8"
          ? corruptedBytes
          : `${JSON.stringify({ ...record, dialogProcessId: "foreign-turn" })}\n`,
      );
      const bytes = await readFile(segment);
      await assert.rejects(append(sessionDir), { code: "EXECUTION_EVENT_JSONL_CORRUPTED" });
      assert.deepEqual(await readFile(indexFile), indexBefore);
      assert.deepEqual(await readFile(segment), bytes);
    });
  });
}

test("streaming decoder preserves valid multibyte sequences crossing input chunks", async () => {
  await withTemp(async (turnDir) => {
    const raw = `${JSON.stringify({ dialogProcessId, content: `${"a".repeat(65500)}中文🙂`.repeat(3) })}\n`;
    await writeFile(path.join(turnDir, file), raw);
    assert.deepEqual(await readExecutionSegmentSummary({ turnDir, file, dialogProcessId }), {
      bytes: Buffer.byteLength(raw),
      records: 1,
    });
  });
});
