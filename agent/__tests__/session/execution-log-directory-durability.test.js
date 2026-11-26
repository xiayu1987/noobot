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
  readExecutionLogs,
  resolveExecutionTurnDir,
  resolveExecutionEventsDir,
} from "../../src/session/session-artifact-execution-logs.js";
import { getFsAdapter, setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { TEST_STORAGE_SERVICE as storageService } from "../helpers/storage-service.js";
import { withTemp } from "../helpers/temporary-directory.js";

const dialogProcessId = "directory-durability-turn";
const record = { dialogProcessId, content: "accepted only after durable preparation" };
const append = (sessionDir) =>
  appendRollingJsonlArtifactLogs({
    storageService,
    sessionDir,
    logs: [record],
    maxSegmentBytes: 4096,
    alreadyLocked: false,
  });

for (const failurePosition of [0, 1, 2, 3]) {
  test(`directory synchronization failure at ancestor ${failurePosition} is retried before accepting logs`, async () => {
    await withTemp(async (sessionDir) => {
      const turnDir = resolveExecutionTurnDir(sessionDir, dialogProcessId);
      const directories = [
        turnDir,
        path.dirname(turnDir),
        resolveExecutionEventsDir(sessionDir),
        sessionDir,
      ];
      const failure = new Error("directory synchronization interrupted");
      let interrupted = false;
      const synced = [];
      const adapter = getFsAdapter();
      setFsAdapter({
        async syncDirectory(directory) {
          if (!interrupted && directory === directories[failurePosition]) {
            interrupted = true;
            throw failure;
          }
          const result = await adapter.syncDirectory(directory);
          if (directories.includes(directory)) synced.push(directory);
          return result;
        },
      });
      try {
        await assert.rejects(append(sessionDir), (error) => error === failure);
        await assert.rejects(readFile(path.join(turnDir, "segment-000001.jsonl")), {
          code: "ENOENT",
        });
        synced.length = 0;
        await append(sessionDir);
        assert.deepEqual(synced.slice(0, directories.length), directories);
        assert.deepEqual(await readExecutionLogs({ storageService, sessionDir }), [record]);
      } finally {
        resetFsAdapter();
      }
    });
  });
}
