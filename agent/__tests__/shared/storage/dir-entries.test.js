/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readDirectoryEntriesIfPresent } from "../../../src/shared/storage/dir-entries.js";

test("readDirectoryEntriesIfPresent lists entries and treats a missing directory as empty", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dir-entries-"));
  try {
    await writeFile(path.join(root, "a.json"), "{}");
    await mkdir(path.join(root, "sub"));
    const names = (await readDirectoryEntriesIfPresent(root)).map((entry) => entry.name).sort();
    assert.deepEqual(names, ["a.json", "sub"]);
    assert.deepEqual(await readDirectoryEntriesIfPresent(path.join(root, "missing")), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readDirectoryEntriesIfPresent propagates non-ENOENT failures", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dir-entries-"));
  try {
    const file = path.join(root, "file.txt");
    await writeFile(file, "x");
    await assert.rejects(readDirectoryEntriesIfPresent(file), { code: "ENOTDIR" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
