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
import { appendJsonLine, flushJsonLineBatches } from "../src/transports/jsonl.js";

test("Windows startup logs flush file bytes without opening directory handles", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-windows-durability-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  context.mock.property(process, "platform", "win32");
  const open = fs.open.bind(fs);
  context.mock.method(fs, "open", async (file, ...options) => {
    if ((await fs.stat(file)).isDirectory())
      throw Object.assign(new Error("Windows directory fsync is unsupported"), { code: "EPERM" });
    return open(file, ...options);
  });
  const appendFile = fs.appendFile.bind(fs);
  const append = context.mock.method(fs, "appendFile", async (file, bytes, options) => {
    assert.equal(options.flush, true);
    return appendFile(file, bytes, options);
  });
  const file = path.join(directory, "startup", "service", "state.jsonl");
  await appendJsonLine(file, { event: "service.startup.completed" });
  await flushJsonLineBatches();
  assert.equal(append.mock.callCount(), 1);
  assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), {
    event: "service.startup.completed",
  });
});

test("Windows log file flush errors still reject receipts", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-windows-flush-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  context.mock.property(process, "platform", "win32");
  const failure = Object.assign(new Error("file fsync failed"), { code: "EPERM" });
  context.mock.method(fs, "appendFile", async () => {
    throw failure;
  });
  await assert.rejects(
    appendJsonLine(path.join(directory, "state.jsonl"), { event: "startup" }),
    (error) => error === failure,
  );
});
