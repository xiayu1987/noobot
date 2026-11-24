/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { open, readdir, mkdir, writeFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { durableJsonPublicationTarget } from "../../src/shared/storage/durable-file.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import {
  appendRollingJsonlArtifactLogs,
  resolveExecutionTurnDir,
  resolveExecutionEventsDir,
} from "../../src/session/session-artifact-execution-logs.js";
import { recoverExecutionLogIndexes } from "../../src/session/execution-log-recovery.js";
import { TEST_STORAGE_SERVICE } from "../helpers/storage-service.js";
import { withTemp } from "../helpers/temporary-directory.js";

async function leaveAtomicPreparation(sessionDir) {
  const failure = new Error("index rename interrupted");
  const cleanupFailure = new Error("temporary removal interrupted");
  const indexPath = path.join(resolveExecutionTurnDir(sessionDir, "turn-1"), "index.json");
  setFsAdapter({
    async rename(source, destination) {
      if (destination === indexPath) throw failure;
      return rename(source, destination);
    },
    async rm(file, options) {
      if (
        path.dirname(file) === path.dirname(indexPath) &&
        durableJsonPublicationTarget(path.basename(file)) === path.basename(indexPath)
      )
        throw cleanupFailure;
      return rm(file, options);
    },
  });
  try {
    await assert.rejects(
      appendRollingJsonlArtifactLogs({
        storageService: TEST_STORAGE_SERVICE,
        sessionDir,
        logs: [{ dialogProcessId: "turn-1", event: "test" }],
        maxSegmentBytes: 4096,
        alreadyLocked: false,
      }),
      (error) => {
        assert.deepEqual(error.errors, [failure, cleanupFailure]);
        return true;
      },
    );
  } finally {
    resetFsAdapter();
  }
  const turnDir = resolveExecutionTurnDir(sessionDir, "turn-1");
  const files = await readdir(turnDir);
  assert.equal(files.length, 1);
  assert.equal(durableJsonPublicationTarget(files[0]), "index.json");
  return { turnDir, files };
}

test("recovery removes only owned interrupted atomic preparation files and publishes an empty index", async () => {
  await withTemp(async (sessionDir) => {
    const { turnDir } = await leaveAtomicPreparation(sessionDir);
    await recoverExecutionLogIndexes({ storageService: TEST_STORAGE_SERVICE, sessionDir });
    assert.deepEqual(await readdir(turnDir), ["index.json"]);
    assert.deepEqual(
      (await recoverExecutionLogIndexes({ storageService: TEST_STORAGE_SERVICE, sessionDir }))
        .repaired,
      [],
    );
  });
});

test("recovery rejects another document's publication before removing owned preparation", async () => {
  await withTemp(async (sessionDir) => {
    const { turnDir, files } = await leaveAtomicPreparation(sessionDir);
    const unrelated = files[0].replace("index.json", "metadata.json");
    await writeFile(path.join(turnDir, unrelated), "unrelated evidence\n");
    await assert.rejects(
      recoverExecutionLogIndexes({ storageService: TEST_STORAGE_SERVICE, sessionDir }),
      { code: "EXECUTION_EVENT_INDEX_CORRUPTED" },
    );
    assert.deepEqual((await readdir(turnDir)).sort(), [...files, unrelated].sort());
  });
});

test("temporary cleanup failure preserves its cause and remains retryable", async () => {
  await withTemp(async (sessionDir) => {
    const { turnDir, files } = await leaveAtomicPreparation(sessionDir);
    const failure = new Error("recovery cleanup failed");
    setFsAdapter({
      async rm() {
        throw failure;
      },
    });
    try {
      await assert.rejects(
        recoverExecutionLogIndexes({ storageService: TEST_STORAGE_SERVICE, sessionDir }),
        (error) => error === failure,
      );
      assert.deepEqual(await readdir(turnDir), files);
    } finally {
      resetFsAdapter();
    }
    await recoverExecutionLogIndexes({ storageService: TEST_STORAGE_SERVICE, sessionDir });
    assert.deepEqual(await readdir(turnDir), ["index.json"]);
  });
});

test("damaged orphan validation precedes every temporary cleanup or index publication", async () => {
  await withTemp(async (sessionDir) => {
    const { turnDir, files } = await leaveAtomicPreparation(sessionDir);
    const other = resolveExecutionTurnDir(sessionDir, "turn-2");
    await mkdir(other);
    await writeFile(path.join(other, "segment-000001.jsonl"), "source evidence\n");
    await assert.rejects(
      recoverExecutionLogIndexes({ storageService: TEST_STORAGE_SERVICE, sessionDir }),
      { code: "EXECUTION_EVENT_INDEX_CORRUPTED" },
    );
    assert.deepEqual(await readdir(turnDir), files);
  });
});

for (let ancestor = 0; ancestor < 4; ancestor += 1) {
  test(`preparation recovery retries directory synchronization at ancestor ${ancestor}`, async () => {
    await withTemp(async (sessionDir) => {
      const turnDir = resolveExecutionTurnDir(sessionDir, "turn-1");
      await mkdir(turnDir, { recursive: true });
      const directories = [
        turnDir,
        path.dirname(turnDir),
        resolveExecutionEventsDir(sessionDir),
        sessionDir,
      ];
      const failure = new Error("preparation directory sync interrupted");
      setFsAdapter({
        async open(file, ...args) {
          const handle = await open(file, ...args);
          if (file !== directories[ancestor]) return handle;
          return new Proxy(handle, {
            get(target, property) {
              if (property === "sync")
                return async () => {
                  throw failure;
                };
              const value = Reflect.get(target, property, target);
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
        },
      });
      try {
        await assert.rejects(
          recoverExecutionLogIndexes({ storageService: TEST_STORAGE_SERVICE, sessionDir }),
          (error) => error === failure,
        );
        assert.deepEqual(await readdir(turnDir), []);
      } finally {
        resetFsAdapter();
      }
      await recoverExecutionLogIndexes({ storageService: TEST_STORAGE_SERVICE, sessionDir });
      assert.deepEqual(await readdir(turnDir), ["index.json"]);
    });
  });
}
