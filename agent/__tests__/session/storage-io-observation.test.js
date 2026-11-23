/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { filePath as path } from "@noobot/path-resolver";
import {
  fsOpen,
  fsReadFile,
  fsRename,
  fsWriteFile,
  getFsAdapter,
} from "../../src/shared/storage/fs-adapter.js";
import { observeStorageIo } from "../helpers/storage-io-observation.js";

test("storage work includes scalar, vector and whole-file I/O exactly once", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "storage-io-observation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "record");
  await writeFile(file, "hello");
  const { work } = await observeStorageIo(root, async () => {
    assert.equal((await fsReadFile(file)).length, 5);
    const handle = await fsOpen(file, "r+");
    try {
      assert.equal((await handle.read(Buffer.alloc(2), 0, 2, 0)).bytesRead, 2);
      assert.equal((await handle.readv([Buffer.alloc(1), Buffer.alloc(2)], 2)).bytesRead, 3);
      assert.equal((await handle.readFile()).length, 5);
      await handle.write(Buffer.from("XY"), 0, 2, 0);
      await handle.writev([Buffer.from("1"), Buffer.from("23")], 2);
      await handle.writeFile("!");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fsWriteFile(file, "abc");
    await fsRename(file, path.join(root, "published"));
  });
  const { elapsedMsByCategory, ...counts } = work;
  assert.deepEqual(counts, {
    openCalls: 1,
    readCalls: 2,
    syncCalls: 1,
    completedSyncs: 1,
    readBytes: 15,
    readBytesByPath: new Map([["record", 15]]),
    writeBytes: 9,
    writeBytesByPath: new Map([["record", 9]]),
    renames: 1,
  });
  assert.deepEqual([...elapsedMsByCategory.keys()].sort(), [
    "open:other",
    "read:other",
    "sync:other",
  ]);
  for (const elapsed of elapsedMsByCategory.values()) {
    assert.ok(Number.isFinite(elapsed) && elapsed >= 0);
  }
});

test("storage work excludes sibling paths and restores the adapter after failure", async (t) => {
  const parent = await mkdtemp(path.join(tmpdir(), "storage-io-scope-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, "session");
  const sibling = path.join(parent, "session-other");
  await mkdir(root);
  await mkdir(sibling);
  const file = path.join(sibling, "record");
  await writeFile(file, "outside");
  const previous = getFsAdapter();
  const { work } = await observeStorageIo(root, async () => {
    await fsReadFile(file);
    const handle = await fsOpen(file, "r+");
    try {
      await handle.readFile();
      await handle.writeFile("outside");
    } finally {
      await handle.close();
    }
    await fsWriteFile(file, "outside");
  });
  assert.deepEqual(work, {
    openCalls: 0,
    readCalls: 0,
    syncCalls: 0,
    completedSyncs: 0,
    readBytes: 0,
    readBytesByPath: new Map(),
    elapsedMsByCategory: new Map(),
    writeBytes: 0,
    writeBytesByPath: new Map(),
    renames: 0,
  });
  const failure = new Error("operation failed");
  await assert.rejects(
    observeStorageIo(root, () => Promise.reject(failure)),
    (error) => error === failure,
  );
  assert.equal(getFsAdapter().open, previous.open);
  assert.equal(getFsAdapter().readFile, previous.readFile);
});
