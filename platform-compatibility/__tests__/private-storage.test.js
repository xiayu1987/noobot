/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensurePrivateStorageDirectory } from "../src/private-storage.js";
import {
  assertPrivateStoragePermissions,
  grantPublicReadForTest,
} from "./helpers/private-storage.js";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-private-storage-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("private storage restricts the directory before creating confidential files", async (t) => {
  const root = await fixture(t);
  const directory = path.join(root, "nested", "private 中文 ' space");
  await ensurePrivateStorageDirectory(directory);
  await assertPrivateStoragePermissions(directory);
  const file = path.join(directory, "secret.json");
  await writeFile(file, "synthetic", { mode: 0o600 });
  await assertPrivateStoragePermissions(file);
});

test("private storage reapplies its policy to an existing directory without losing files", async (t) => {
  const root = await fixture(t);
  const directory = path.join(root, "existing");
  await mkdir(directory);
  const file = path.join(directory, "existing.json");
  await writeFile(file, "retained", { mode: 0o600 });
  await ensurePrivateStorageDirectory(directory);
  await ensurePrivateStorageDirectory(directory);
  await assertPrivateStoragePermissions(directory);
  await assertPrivateStoragePermissions(file);
  assert.equal(await readFile(file, "utf8"), "retained");
});

test("private storage restricts declared old files with independent permissions without rewriting content", async (t) => {
  const directory = await fixture(t);
  const file = path.join(directory, "old.json");
  await writeFile(file, "retained bytes", { mode: 0o600 });
  await grantPublicReadForTest(file);
  await assert.rejects(assertPrivateStoragePermissions(file));
  await ensurePrivateStorageDirectory(directory, ["old.json", "missing.json"]);
  await assertPrivateStoragePermissions(file);
  assert.equal(await readFile(file, "utf8"), "retained bytes");
  await assert.rejects(readFile(path.join(directory, "missing.json")), { code: "ENOENT" });
});

test("private storage rejects file names outside the declared directory", async (t) => {
  const directory = await fixture(t);
  for (const name of ["..", ".", "../secret", "nested/secret", "nested\\secret", ""]) {
    await assert.rejects(ensurePrivateStorageDirectory(directory, [name]), TypeError);
  }
});

test("private storage rejects a directory where a confidential file is required", async (t) => {
  const directory = await fixture(t);
  await mkdir(path.join(directory, "not-a-file"));
  await assert.rejects(ensurePrivateStorageDirectory(directory, ["not-a-file"]), /regular file/);
});

test("private storage rejects directory links without changing their targets", async (t) => {
  const root = await fixture(t);
  const target = path.join(root, "target");
  const link = path.join(root, "link");
  await mkdir(target);
  await symlink(target, link, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(ensurePrivateStorageDirectory(link), /must not be/);
  await writeFile(path.join(target, "still-accessible"), "retained");
  assert.equal(await readFile(path.join(target, "still-accessible"), "utf8"), "retained");
});

test("private storage propagates a non-directory path failure", async (t) => {
  const root = await fixture(t);
  const file = path.join(root, "file");
  await writeFile(file, "retained");
  await assert.rejects(ensurePrivateStorageDirectory(file));
  assert.equal(await readFile(file, "utf8"), "retained");
});
