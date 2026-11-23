/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { TEST_STORAGE_SERVICE as storage } from "../../helpers/storage-service.js";
import {
  fileExists,
  readOptionalJson,
  readText,
  safeReadDirEntries,
} from "../../../src/memory/storage/file-ops.js";
import { resolveWorkspaceDirectories } from "../../../src/context/providers/workspace-provider.js";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "persistence-path-failures-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const blocked = path.join(root, "blocked");
  await writeFile(blocked, "obstruction");
  return { blocked, missing: path.join(root, "missing") };
}

test("storage probes and optional text distinguish missing paths from obstructed parents", async (t) => {
  const { blocked, missing } = await fixture(t);
  for (const method of ["exists", "isDirectory", "readTextOrNull"]) {
    assert.equal(await storage[method](missing), method === "readTextOrNull" ? null : false);
    await assert.rejects(storage[method](path.join(blocked, "child")), { code: "ENOTDIR" });
  }
  assert.equal(await readFile(blocked, "utf8"), "obstruction");
});

test("optional JSON preserves path and cause for obstructed parents", async (t) => {
  const { blocked, missing } = await fixture(t);
  const filePath = path.join(blocked, "child.json");
  for (const read of [(file) => storage.readOptionalJson(file), readOptionalJson]) {
    assert.equal(await read(missing), null);
    await assert.rejects(read(filePath), (error) => {
      assert.equal(error.code, "PERSISTENCE_IO_FAILED");
      assert.equal(error.persistencePath, filePath);
      assert.equal(error.cause.code, "ENOTDIR");
      return true;
    });
  }
});

test("memory probes, text and directory reads propagate structural failures", async (t) => {
  const { blocked, missing } = await fixture(t);
  assert.equal(await fileExists(missing), false);
  assert.equal(await readText(missing, "missing"), "missing");
  assert.deepEqual(await safeReadDirEntries(missing), []);
  const child = path.join(blocked, "child");
  await assert.rejects(fileExists(child), { code: "ENOTDIR" });
  await assert.rejects(readText(child, "missing"), { code: "ENOTDIR" });
  for (const directory of [blocked, child]) {
    await assert.rejects(safeReadDirEntries(directory), { code: "ENOTDIR" });
  }
});

test("workspace context rejects obstructed roots and runtime directories", async (t) => {
  const { blocked, missing } = await fixture(t);
  assert.deepEqual(await resolveWorkspaceDirectories(missing), []);
  await assert.rejects(resolveWorkspaceDirectories(blocked), { code: "ENOTDIR" });
  const root = path.dirname(blocked);
  await writeFile(path.join(root, "runtime"), "obstruction");
  await assert.rejects(resolveWorkspaceDirectories(root), { code: "ENOTDIR" });
});
