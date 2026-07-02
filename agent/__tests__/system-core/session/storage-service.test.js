/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { StorageService } from "../../../src/system-core/session/storage-service.js";
import { resetFsAdapter, setFsAdapter } from "../../../src/system-core/store/fs-adapter.js";

test.afterEach(() => {
  resetFsAdapter();
});

test("writeJsonAtomic retries transient Windows rename EPERM errors", async () => {
  const writes = new Map();
  const renames = [];
  let renameAttempts = 0;

  setFsAdapter({
    writeFile: async (filePath, content) => {
      writes.set(filePath, content);
    },
    rename: async (source, target) => {
      renameAttempts += 1;
      renames.push({ source, target });
      if (renameAttempts === 1) {
        const error = new Error("file is temporarily locked");
        error.code = "EPERM";
        throw error;
      }
      writes.set(target, writes.get(source));
      writes.delete(source);
    },
    rm: async (filePath) => {
      writes.delete(filePath);
    },
  });

  const storage = new StorageService({ atomicRenameRetryDelaysMs: [1] });
  await storage.writeJsonAtomic("C:/workspace/runtime/session/session-tree.json", {
    ok: true,
  });

  assert.equal(renameAttempts, 2);
  assert.equal(renames[0].target, "C:/workspace/runtime/session/session-tree.json");
  assert.equal(
    writes.get("C:/workspace/runtime/session/session-tree.json"),
    JSON.stringify({ ok: true }, null, 2),
  );
});

test("writeJsonAtomic cleans up temp file when rename cannot recover", async () => {
  const writes = new Map();
  const removed = [];

  setFsAdapter({
    writeFile: async (filePath, content) => {
      writes.set(filePath, content);
    },
    rename: async () => {
      const error = new Error("permission denied");
      error.code = "EACCES";
      throw error;
    },
    rm: async (filePath) => {
      removed.push(filePath);
      writes.delete(filePath);
    },
  });

  const storage = new StorageService({ atomicRenameRetryDelaysMs: [1, 1] });
  await assert.rejects(
    () => storage.writeJsonAtomic("/tmp/session-tree.json", { ok: false }),
    /permission denied/,
  );

  assert.equal(writes.size, 0);
  assert.equal(removed.length, 1);
  assert.match(removed[0], /session-tree\.json\.tmp-/);
});
