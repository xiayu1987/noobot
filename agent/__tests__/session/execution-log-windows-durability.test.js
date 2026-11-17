/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { fileSyncOpenFlags } from "@noobot/platform-compatibility/file-system";
import {
  appendRollingJsonlArtifactLogs,
  readExecutionLogs,
  listExecutionEventTurns,
} from "../../src/session/session-artifact-execution-logs.js";
import { TEST_STORAGE_SERVICE as storageService } from "../helpers/storage-service.js";
import { withTemp } from "./session-artifact-store-v2.test-helpers.js";

test("index sync requests write access only on Windows", () => {
  for (const platform of ["win32", "win", "windows"])
    assert.equal(fileSyncOpenFlags(platform), "r+");
  for (const platform of ["linux", "darwin"])
    assert.equal(fileSyncOpenFlags(platform), "r");
});

test("Windows execution indexes sync during registration, append and rollover", async (context) => {
  context.mock.property(process, "platform", "win32");
  await withTemp(async (sessionDir) => {
    const records = [
      { dialogProcessId: "windows-turn-1", content: "first" },
      { dialogProcessId: "windows-turn-1", content: "second" },
      { dialogProcessId: "windows-turn-2", content: "third" },
    ];
    for (const record of records) {
      await appendRollingJsonlArtifactLogs({
        storageService,
        sessionDir,
        logs: [record],
        maxSegmentBytes: 1,
        alreadyLocked: false,
      });
    }
    assert.deepEqual(await readExecutionLogs({ storageService, sessionDir }), records);
    assert.deepEqual(await listExecutionEventTurns({ storageService, sessionDir }), [
      { dialogProcessId: "windows-turn-1" },
      { dialogProcessId: "windows-turn-2" },
    ]);
  });
});
