/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { appendJsonLine, flushJsonLineBatches } from "../src/transports/jsonl.js";

const execFileAsync = promisify(execFile);

test("flushJsonLineBatches persists a pending batch before its timer fires", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-jsonl-flush-"));
  const file = path.join(root, "pending.jsonl");
  try {
    const pendingWrite = appendJsonLine(file, { sequence: 1 });
    await flushJsonLineBatches();
    await pendingWrite;
    const records = (await fs.readFile(file, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(records, [{ sequence: 1 }]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("appendJsonLine keeps its asynchronous write alive until the returned promise resolves", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-jsonl-lifecycle-"));
  const file = path.join(root, "pending.jsonl");
  const script = `
    import { appendJsonLine } from ${JSON.stringify(path.resolve("src/transports/jsonl.js"))};
    await appendJsonLine(process.argv[1], { sequence: 1 });
    process.stdout.write('completed\\n');
  `;
  try {
    const result = await execFileAsync(
      process.execPath,
      ["--input-type=module", "--eval", script, file],
      {
        cwd: path.resolve("."),
        encoding: "utf8",
      },
    );
    assert.equal(result.stdout.trim(), "completed");
    assert.deepEqual(JSON.parse((await fs.readFile(file, "utf8")).trim()), { sequence: 1 });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
