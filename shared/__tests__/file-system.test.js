/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import * as native from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import * as fs from "../file-system.js";

for (const name of [
  "access",
  "lstat",
  "open",
  "readFile",
  "readdir",
  "realpath",
  "stat",
  "unlink",
  "rm",
]) {
  test(`${name} distinguishes absence from obstructed ancestors`, async (t) => {
    const root = await native.mkdtemp(path.join(tmpdir(), "filesystem-contract-"));
    t.after(() => native.rm(root, { recursive: true, force: true }));
    const blocked = path.join(root, "blocked");
    await native.writeFile(blocked, "evidence");
    for (const target of [path.join(root, "missing"), path.join(root, "missing", "child")]) {
      await assert.rejects(fs[name](target), { code: "ENOENT" });
    }
    for (const suffix of ["child", path.join("child", "grandchild")]) {
      const target = path.join(blocked, suffix);
      await assert.rejects(fs[name](target), { code: "ENOTDIR" });
      await assert.rejects(fs[name](pathToFileURL(target)), { code: "ENOTDIR" });
    }
    assert.equal(await native.readFile(blocked, "utf8"), "evidence");
  });
}

test("successful reads and non-missing failures retain native semantics", async (t) => {
  const root = await native.mkdtemp(path.join(tmpdir(), "filesystem-read-"));
  t.after(() => native.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "file");
  await native.writeFile(file, "content");
  assert.equal(await fs.readFile(file, "utf8"), "content");
  assert.deepEqual(await fs.readdir(root), ["file"]);
  await assert.rejects(fs.readdir(file), { code: "ENOTDIR" });
});

test("forced removal ignores absence but preserves obstructions and other failures", async (t) => {
  const root = await native.mkdtemp(path.join(tmpdir(), "filesystem-remove-"));
  t.after(() => native.rm(root, { recursive: true, force: true }));
  const blocked = path.join(root, "blocked");
  await native.writeFile(blocked, "evidence");
  await fs.rm(path.join(root, "missing", "child"), { recursive: true, force: true });
  await assert.rejects(fs.rm(path.join(blocked, "child"), { recursive: true, force: true }), {
    code: "ENOTDIR",
  });
  assert.equal(await native.readFile(blocked, "utf8"), "evidence");
  const directory = path.join(root, "directory");
  await native.mkdir(directory);
  await native.writeFile(path.join(directory, "child"), "content");
  await assert.rejects(fs.rm(directory, { force: true }));
  await fs.rm(directory, { recursive: true, force: true });
  await assert.rejects(native.stat(directory), { code: "ENOENT" });
});
