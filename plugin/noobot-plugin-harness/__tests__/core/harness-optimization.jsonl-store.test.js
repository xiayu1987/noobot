/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createRunPaths } from "../../src/core/context.js";
import {
  appendJsonlBuffered,
  flushAllJsonlBuffers,
  initializeRun,
  readJson,
  writeJson,
} from "../../src/store/store.js";

async function storeRun(basePath) {
  const run = createRunPaths(
    { sessionId: "store-session", dialogProcessId: "store-run" },
    { basePath },
  );
  await initializeRun(run);
  return run;
}

test("run directory keys preserve canonical dialog identity and reject aliases", () => {
  const options = { basePath: os.tmpdir() };
  const pathsFor = (dialogProcessId) =>
    createRunPaths({ sessionId: "store-session", dialogProcessId }, options);
  const canonical = `_${"a".repeat(125)}-9`;
  assert.equal(path.basename(pathsFor(canonical).runDir), canonical);
  assert.equal(path.basename(pathsFor("store_run").runDir), "store_run");
  for (const value of ["store/run", "store.run", " store_run ", canonical + "x", ""]) {
    assert.throws(() => pathsFor(value), TypeError);
  }
});

test("JSONL failures retain ordered records, reject capacity overflow and recover without duplication", async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-harness-jsonl-recovery-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const run = await storeRun(base);
  const target = run.events;
  const strategy = {
    maxSize: 1,
    maxTime: 0,
    maxRetry: 0,
    maxBufferEntries: 2,
    maxBufferBytes: 100,
  };
  const appendFile = fs.appendFile;
  const failure = new Error("injected append failure");
  const mock = t.mock.method(fs, "appendFile", async (file, ...args) => {
    if (file === target) throw failure;
    return appendFile(file, ...args);
  });
  const results = await Promise.allSettled(
    [1, 2, 3].map((id) => appendJsonlBuffered(run, target, { id }, strategy)),
  );
  for (const result of results) {
    assert.equal(result.status, "rejected");
    assert.equal(result.reason, failure);
  }
  await assert.rejects(
    appendJsonlBuffered(run, target, { payload: "x".repeat(101) }, strategy),
    RangeError,
  );
  mock.mock.restore();
  await flushAllJsonlBuffers();
  assert.deepEqual((await fs.readFile(target, "utf8")).trim().split("\n").map(JSON.parse), [
    { id: 1 },
    { id: 2 },
  ]);
  await appendJsonlBuffered(run, target, { id: 3 }, strategy);
  assert.deepEqual((await fs.readFile(target, "utf8")).trim().split("\n").map(JSON.parse), [
    { id: 1 },
    { id: 2 },
    { id: 3 },
  ]);
});

test("run writes serialize across files and preserve rejection while releasing the lock", async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-harness-run-write-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const run = await storeRun(base);
  const writeFile = fs.writeFile;
  let active = 0;
  let maxActive = 0;
  const failure = new Error("injected write failure");
  t.mock.method(fs, "writeFile", async (file, ...args) => {
    if (!String(file).includes(".tmp.")) return writeFile(file, ...args);
    active += 1;
    maxActive = Math.max(maxActive, active);
    try {
      if (String(file).includes("failed.json.tmp.")) throw failure;
      return await writeFile(file, ...args);
    } finally {
      active -= 1;
    }
  });
  const results = await Promise.allSettled(
    ["a.json", "failed.json", "b.json"].map((name) =>
      writeJson(run, path.join(run.runDir, name), { name }),
    ),
  );
  assert.equal(maxActive, 1);
  assert.deepEqual(
    results.map(({ status }) => status),
    ["fulfilled", "rejected", "fulfilled"],
  );
  assert.equal(results[1].reason, failure);
  assert.deepEqual((await fs.readdir(run.runDir)).sort(), ["a.json", "b.json", "harness-run.json"]);
});

test("JSON verification failure leaves the existing target intact and removes temporary files", async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-harness-json-verify-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const run = await storeRun(base);
  const target = path.join(run.runDir, "artifact.json");
  await writeJson(run, target, { original: true });
  const previous = process.env.HARNESS_VALIDATE_WRITES;
  process.env.HARNESS_VALIDATE_WRITES = "1";
  t.after(() => {
    if (previous === undefined) delete process.env.HARNESS_VALIDATE_WRITES;
    else process.env.HARNESS_VALIDATE_WRITES = previous;
  });
  const readFile = fs.readFile;
  const mock = t.mock.method(fs, "readFile", async (file, ...args) =>
    String(file).startsWith(`${target}.tmp.`) ? '{"wrong":true}' : readFile(file, ...args),
  );
  await assert.rejects(writeJson(run, target, { replacement: true }), /verification mismatch/);
  mock.mock.restore();
  assert.deepEqual(await readJson(target), { original: true });
  assert.deepEqual((await fs.readdir(run.runDir)).sort(), ["artifact.json", "harness-run.json"]);
});

test("readJson returns fallback only for a missing persistence path", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-harness-json-read-"));
  const missingPath = path.join(base, "missing.json");
  assert.deepEqual(await readJson(missingPath, { missing: true }), { missing: true });

  const corruptedPath = path.join(base, "corrupted.json");
  await fs.writeFile(corruptedPath, "{not-json", "utf8");
  await assert.rejects(readJson(corruptedPath, {}), SyntaxError);
});

test("appendJsonlBuffered supports adaptive flush by reason", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-harness-jsonl-"));
  const run = await storeRun(base);
  const filePath = run.events;
  const strategy = { maxSize: 100, maxTime: 60000, onTerminal: true, onError: true };

  await appendJsonlBuffered(run, filePath, { id: 1 }, strategy, { reason: "terminal" });
  const first = await fs.readFile(filePath, "utf8");
  assert.match(first, /"id":1/);

  await appendJsonlBuffered(run, filePath, { id: 2 }, strategy, { reason: "error" });
  const second = await fs.readFile(filePath, "utf8");
  assert.match(second, /"id":2/);

  await flushAllJsonlBuffers();
});

test("appendJsonlBuffered rotates active JSONL and prunes old archives", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-harness-jsonl-rotate-"));
  const run = await storeRun(base);
  const filePath = run.events;
  const strategy = {
    maxSize: 1,
    maxTime: 60000,
    onTerminal: true,
    onError: true,
    maxFileBytes: 80,
    maxFiles: 2,
  };

  await appendJsonlBuffered(run, filePath, { id: 1, payload: "x".repeat(120) }, strategy, {
    reason: "terminal",
  });
  await appendJsonlBuffered(run, filePath, { id: 2, payload: "y".repeat(120) }, strategy, {
    reason: "terminal",
  });

  const afterSecond = await fs.readdir(run.runDir);
  const rotatedAfterSecond = afterSecond.filter(
    (name) => name !== "events.jsonl" && name.startsWith("events.") && name.endsWith(".jsonl"),
  );
  assert.equal(rotatedAfterSecond.length, 1);

  const activeAfterSecond = await fs.readFile(filePath, "utf8");
  assert.match(activeAfterSecond, /"id":2/);
  assert.doesNotMatch(activeAfterSecond, /"id":1/);

  await appendJsonlBuffered(run, filePath, { id: 3, payload: "z".repeat(120) }, strategy, {
    reason: "terminal",
  });
  await appendJsonlBuffered(run, filePath, { id: 4, payload: "w".repeat(120) }, strategy, {
    reason: "terminal",
  });

  const entries = await fs.readdir(run.runDir);
  const rotated = entries.filter(
    (name) => name !== "events.jsonl" && name.startsWith("events.") && name.endsWith(".jsonl"),
  );
  assert.equal(rotated.length, 2);
  const active = await fs.readFile(filePath, "utf8");
  assert.match(active, /"id":4/);
});
