/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appendJsonLine } from "../src/transports/jsonl.js";

async function workspace(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-append-sync-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const operations = [];
  const appendFile = fs.appendFile.bind(fs);
  const open = fs.open.bind(fs);
  t.mock.method(fs, "appendFile", async (file, bytes, options) => {
    assert.equal(options.flush, true);
    await appendFile(file, bytes, options);
    operations.push("data");
  });
  t.mock.method(fs, "open", async (target, ...options) => {
    const handle = await open(target, ...options);
    if (target === root) {
      const sync = handle.sync.bind(handle);
      handle.sync = async () => {
        await sync();
        operations.push("directory");
      };
    }
    return handle;
  });
  return { root, file: path.join(root, "events.jsonl"), operations };
}

test("each append synchronizes bytes while an unchanged directory entry is synchronized once", async (t) => {
  const { file, operations } = await workspace(t);
  for (let number = 0; number < 5; number += 1) await appendJsonLine(file, { number });
  assert.deepEqual(operations, ["data", "directory", "data", "data", "data", "data"]);
  assert.equal((await fs.readFile(file, "utf8")).trim().split("\n").length, 5);
});

test("rotation synchronizes the renamed and newly created directory entries before receipt", async (t) => {
  const { root, file, operations } = await workspace(t);
  const options = { maxFileBytes: 20 };
  await appendJsonLine(file, { value: 1 }, options);
  await appendJsonLine(file, { value: 2 }, options);
  assert.deepEqual(operations, ["data", "directory", "data", "directory"]);
  assert.equal((await fs.readdir(root)).filter((name) => name.endsWith(".jsonl")).length, 2);
});

test("a replaced destination synchronizes its new directory entry before acknowledgement", async (t) => {
  const { file, operations } = await workspace(t);
  await appendJsonLine(file, { value: 1 });
  const replacement = `${file}.replacement`;
  await fs.writeFile(replacement, '{"foreign":true}\n', { flush: true });
  await fs.rename(replacement, file);
  await appendJsonLine(file, { value: 2 });
  await appendJsonLine(file, { value: 3 });
  assert.deepEqual(operations, ["data", "directory", "data", "directory", "data"]);
  assert.deepEqual((await fs.readFile(file, "utf8")).trim().split("\n").map(JSON.parse), [
    { foreign: true },
    { value: 2 },
    { value: 3 },
  ]);
});

test("failed data append invalidates directory knowledge before a successful retry", async (t) => {
  const { file, operations } = await workspace(t);
  await appendJsonLine(file, { value: 1 });
  const appendFile = fs.appendFile.bind(fs);
  const failure = new Error("append failed after receipt boundary");
  let fail = true;
  t.mock.method(fs, "appendFile", async (...args) => {
    if (fail) {
      fail = false;
      throw failure;
    }
    return appendFile(...args);
  });
  await assert.rejects(appendJsonLine(file, { value: 2 }), (error) => error === failure);
  await appendJsonLine(file, { value: 3 });
  assert.deepEqual(operations, ["data", "directory", "data", "directory"]);
  assert.deepEqual((await fs.readFile(file, "utf8")).trim().split("\n").map(JSON.parse), [
    { value: 1 },
    { value: 3 },
  ]);
});
