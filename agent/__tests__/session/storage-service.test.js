/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { StorageService } from "../../src/session/storage-service.js";
import { ATOMIC_RENAME_RETRY_DELAYS_MS } from "../../src/shared/storage/atomic-file-write.js";
import { resetFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";

test.afterEach(() => {
  resetFsAdapter();
});

test("readJson rejects missing files while readOptionalJson returns null", async () => {
  setFsAdapter({
    readFile: async () => {
      const error = new Error("missing");
      error.code = "ENOENT";
      throw error;
    },
  });
  const storage = new StorageService({
    atomicRenameRetryDelaysMs: ATOMIC_RENAME_RETRY_DELAYS_MS,
    platform: process.platform,
  });
  await assert.rejects(storage.readJson("/tmp/missing.json"), {
    code: "PERSISTED_JSON_MISSING",
    persistencePath: "/tmp/missing.json",
  });
  assert.equal(await storage.readOptionalJson("/tmp/missing.json"), null);
});

test("readJson and readOptionalJson preserve corrupted and permission-denied failures", async () => {
  const storage = new StorageService({
    atomicRenameRetryDelaysMs: ATOMIC_RENAME_RETRY_DELAYS_MS,
    platform: process.platform,
  });
  setFsAdapter({ readFile: async () => "{broken" });
  for (const read of [storage.readJson, storage.readOptionalJson]) {
    await assert.rejects(read.call(storage, "/tmp/broken.json"), {
      code: "PERSISTED_JSON_CORRUPTED",
      persistencePath: "/tmp/broken.json",
    });
  }

  setFsAdapter({
    readFile: async () => {
      const error = new Error("denied");
      error.code = "EACCES";
      throw error;
    },
  });
  for (const read of [storage.readJson, storage.readOptionalJson]) {
    await assert.rejects(read.call(storage, "/tmp/private.json"), {
      code: "PERSISTENCE_PERMISSION_DENIED",
      persistencePath: "/tmp/private.json",
    });
  }
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

  const storage = new StorageService({
    atomicRenameRetryDelaysMs: [1],
    platform: "win32",
  });
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

  const storage = new StorageService({
    atomicRenameRetryDelaysMs: [1, 1],
    platform: "linux",
  });
  await assert.rejects(
    () => storage.writeJsonAtomic("/tmp/session-tree.json", { ok: false }),
    /permission denied/,
  );

  assert.equal(writes.size, 0);
  assert.equal(removed.length, 1);
  assert.match(removed[0], /[\\/]\.noobot-atomic-[0-9a-f-]{36}$/);
});
