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

test("flushJsonLineBatches persists a pending batch before its scheduled flush", async () => {
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

test("concurrent flush calls drain writes admitted by earlier write receipts", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-jsonl-flush-chain-"));
  const file = path.join(root, "events.jsonl");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const originalAppend = fs.appendFile.bind(fs);
  const blocked = Promise.withResolvers();
  const entered = Promise.withResolvers();
  let writes = 0;
  t.mock.method(fs, "appendFile", async (...args) => {
    writes += 1;
    if (writes === 3) {
      entered.resolve();
      await blocked.promise;
    }
    return originalAppend(...args);
  });
  const chain = appendJsonLine(file, { n: 1 })
    .then(() => appendJsonLine(file, { n: 2 }))
    .then(() => appendJsonLine(file, { n: 3 }));
  let completed = 0;
  const flushes = [flushJsonLineBatches(), flushJsonLineBatches()].map((flush) =>
    flush.then(() => {
      completed += 1;
    }),
  );
  try {
    await entered.promise;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(completed, 0, "flush must not acknowledge an in-flight accepted write");
  } finally {
    blocked.resolve();
    await Promise.all([...flushes, chain]);
  }
  assert.equal(completed, 2);
  assert.deepEqual((await fs.readFile(file, "utf8")).trim().split("\n").map(JSON.parse), [
    { n: 1 },
    { n: 2 },
    { n: 3 },
  ]);
});

test("concurrent flush barriers report failed writes after draining healthy writes", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-jsonl-flush-failure-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const failedFile = path.join(root, "failed.jsonl");
  const healthyFile = path.join(root, "healthy.jsonl");
  const failure = new Error("injected append failure");
  const blocked = Promise.withResolvers();
  const entered = Promise.withResolvers();
  const originalAppend = fs.appendFile.bind(fs);
  t.mock.method(fs, "appendFile", async (file, ...args) => {
    if (file === failedFile) throw failure;
    entered.resolve();
    await blocked.promise;
    return originalAppend(file, ...args);
  });
  const failed = assert.rejects(appendJsonLine(failedFile, { n: 1 }), (e) => e === failure);
  const healthy = appendJsonLine(healthyFile, { n: 2 });
  let completed = 0;
  const barriers = Array.from({ length: 2 }, () =>
    flushJsonLineBatches().then(
      () => {
        completed += 1;
        return null;
      },
      (error) => {
        completed += 1;
        return error;
      },
    ),
  );
  try {
    await Promise.all([failed, entered.promise]);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(completed, 0);
  } finally {
    blocked.resolve();
    await healthy;
  }
  for (const result of await Promise.all(barriers)) {
    assert.ok(result instanceof AggregateError);
    assert.deepEqual(result.errors, [failure]);
  }
  assert.deepEqual(JSON.parse(await fs.readFile(healthyFile, "utf8")), { n: 2 });
  t.mock.restoreAll();
  await appendJsonLine(failedFile, { n: 3 });
  await flushJsonLineBatches();
});

test("sequentially awaited appends persist every record in order", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-jsonl-sequential-"));
  const file = path.join(root, "sequential.jsonl");
  const count = 40;
  try {
    const startedAt = performance.now();
    for (let sequence = 0; sequence < count; sequence += 1) {
      await appendJsonLine(file, { sequence });
    }
    const elapsedMs = performance.now() - startedAt;
    const lines = (await fs.readFile(file, "utf8")).trim().split("\n");
    assert.deepEqual(
      lines.map((line) => JSON.parse(line).sequence),
      Array.from({ length: count }, (_, sequence) => sequence),
    );
    await t.test("performance: sequential append elapsed time", () => {
      assert.ok(elapsedMs < 1000, `sequential appends took ${elapsedMs.toFixed(0)}ms`);
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("records appended during an in-flight write are committed as one ordered batch", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-jsonl-group-"));
  const file = path.join(root, "group.jsonl");
  try {
    const first = appendJsonLine(file, { sequence: 0 });
    await new Promise((resolve) => setImmediate(resolve));
    const rest = Array.from({ length: 30 }, (_, index) =>
      appendJsonLine(file, { sequence: index + 1 }),
    );
    await Promise.all([first, ...rest]);
    const lines = (await fs.readFile(file, "utf8")).trim().split("\n");
    assert.deepEqual(
      lines.map((line) => JSON.parse(line).sequence),
      Array.from({ length: 31 }, (_, sequence) => sequence),
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("appendJsonLine keeps its asynchronous write alive until the returned promise resolves", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-jsonl-lifecycle-"));
  const file = path.join(root, "pending.jsonl");
  const script = `
    import { appendJsonLine } from ${JSON.stringify(new URL("../src/transports/jsonl.js", import.meta.url).href)};
    await appendJsonLine(process.argv[1], { sequence: 1 });
    process.stdout.write('completed\\n');
  `;
  try {
    const result = await execFileAsync(
      process.execPath,
      [
        "--import",
        import.meta.resolve("@noobot/shared/testing/runtime-params"),
        "--input-type=module",
        "--eval",
        script,
        file,
      ],
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
