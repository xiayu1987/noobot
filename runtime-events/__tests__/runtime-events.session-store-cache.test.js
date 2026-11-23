/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readSessionStore } from "../src/session-store-reader.js";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "session-store-cache-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return path.join(root, "store.json");
}

test("unchanged store is parsed once and its retained projection is immutable", async (t) => {
  const file = await fixture(t);
  await fs.writeFile(file, '{"value":1}');
  let calls = 0;
  const parse = ({ raw }) => {
    calls += 1;
    return JSON.parse(raw);
  };
  const first = await readSessionStore(file, parse);
  assert.throws(() => {
    first.value = 2;
  }, TypeError);
  assert.equal(await readSessionStore(file, parse), first);
  assert.equal(calls, 1);
});

test("same-size rewrite and atomic replacement invalidate immediately", async (t) => {
  const file = await fixture(t);
  const parse = ({ raw }) => JSON.parse(raw);
  await fs.writeFile(file, '{"value":1}');
  assert.equal((await readSessionStore(file, parse)).value, 1);
  const info = await fs.stat(file);
  await fs.writeFile(file, '{"value":2}');
  await fs.utimes(file, info.atime, info.mtime);
  assert.equal((await readSessionStore(file, parse)).value, 2);
  await fs.writeFile(`${file}.new`, '{"value":3}');
  await fs.rename(`${file}.new`, file);
  assert.equal((await readSessionStore(file, parse)).value, 3);
});

test("an obstructed store path fails without parsing absence or reusing cached state", async (t) => {
  const root = path.dirname(await fixture(t));
  const directory = path.join(root, "session");
  const file = path.join(directory, "store.json");
  const parse = ({ raw }) => {
    assert.notEqual(raw, null, "Structural failures must not reach the missing-store parser");
    return JSON.parse(raw);
  };
  await fs.mkdir(directory);
  await fs.writeFile(file, '{"value":1}');
  assert.equal((await readSessionStore(file, parse)).value, 1);
  await fs.rm(directory, { recursive: true });
  await fs.writeFile(directory, "obstruction");
  await assert.rejects(readSessionStore(file, parse), { code: "ENOTDIR" });
  assert.equal(await fs.readFile(directory, "utf8"), "obstruction");
  await fs.unlink(directory);
  await fs.mkdir(directory);
  await fs.writeFile(file, '{"value":2}');
  assert.equal((await readSessionStore(file, parse)).value, 2);
});

test("missing and corrupted stores never reuse the last valid projection", async (t) => {
  const file = await fixture(t);
  const parse = ({ raw }) => (raw === null ? null : JSON.parse(raw));
  await fs.writeFile(file, '{"value":1}');
  await readSessionStore(file, parse);
  await fs.unlink(file);
  assert.equal(await readSessionStore(file, parse), null);
  await fs.writeFile(file, '{"value":2}');
  assert.equal((await readSessionStore(file, parse)).value, 2);
  await fs.writeFile(file, "invalid");
  await assert.rejects(readSessionStore(file, parse), SyntaxError);
  await fs.writeFile(file, '{"value":3}');
  assert.equal((await readSessionStore(file, parse)).value, 3);
});
