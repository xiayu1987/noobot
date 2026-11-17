/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  executionLogProjectionIdentity,
  EXECUTION_PROJECTION_PENDING_SUFFIX,
  decodeExecutionProjectionOutputRecord,
} from "@noobot/session-protocol";
import { appendJsonLine } from "../src/transports/jsonl.js";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "projection-output-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "interaction.jsonl");
  const receipt = path.join(root, "projection-receipt.interaction.jsonl.json");
  const options = (offset = 0, extra = {}) => ({
    ...extra,
    projection: {
      file: receipt,
      sourceId: executionLogProjectionIdentity("d1", 1, offset),
    },
  });
  const read = async () => (await fs.readFile(file, "utf8")).trim().split("\n").map(JSON.parse);
  return { root, file, receipt, options, read };
}

test("large admitted records split before the output intent byte limit and replay without duplicates", async (t) => {
  const f = await fixture(t);
  const data = "x".repeat(5 * 1024 * 1024 - 1024);
  const write = () =>
    Promise.all(
      Array.from({ length: 7 }, (_, n) => appendJsonLine(f.file, { n, data }, f.options(n))),
    );
  await write();
  const before = await fs.stat(f.file);
  const lines = createInterface({ input: createReadStream(f.file), crlfDelay: Infinity });
  let count = 0;
  for await (const line of lines) {
    const record = JSON.parse(line);
    assert.equal(record.n, count++);
    assert.equal(record.data.length, data.length);
  }
  assert.equal(count, 7);
  await write();
  assert.equal((await fs.stat(f.file)).size, before.size);
  assert.equal(
    decodeExecutionProjectionOutputRecord(await fs.readFile(f.receipt)).sourceId,
    f.options(6).projection.sourceId,
  );
});

test("a failed parallel receipt waits for every started publication before recovery", async (t) => {
  const f = await fixture(t);
  const second = path.join(f.root, "second.receipt.json");
  const options = {
    projection: { file: second, sourceId: executionLogProjectionIdentity("d2", 1, 0) },
  };
  const failure = new Error("first receipt failed");
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const rename = fs.rename.bind(fs);
  const mock = t.mock.method(fs, "rename", async (source, destination) => {
    if (destination === f.receipt) throw failure;
    if (destination === second) {
      entered.resolve();
      await release.promise;
    }
    return rename(source, destination);
  });
  let completed = false;
  const writes = Promise.allSettled([
    appendJsonLine(f.file, { n: 1 }, f.options()),
    appendJsonLine(f.file, { n: 2 }, options),
  ]).then((results) => {
    completed = true;
    return results;
  });
  try {
    await entered.promise;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(completed, false);
  } finally {
    release.resolve();
  }
  const results = await writes;
  assert.ok(results.every((result) => result.status === "rejected" && result.reason === failure));
  mock.mock.restore();
  await Promise.all([
    appendJsonLine(f.file, { n: 1 }, f.options()),
    appendJsonLine(f.file, { n: 2 }, options),
  ]);
  assert.deepEqual(await f.read(), [{ n: 1 }, { n: 2 }]);
});

for (const afterRename of [false, true]) {
  test(`receipt rename failure (${afterRename ? "after" : "before"} publication) replays without another output`, async (t) => {
    const f = await fixture(t);
    const failure = new Error("receipt rename failed");
    const rename = fs.rename.bind(fs);
    const mock = t.mock.method(fs, "rename", async (source, destination) => {
      if (destination !== f.receipt) return rename(source, destination);
      if (afterRename) await rename(source, destination);
      throw failure;
    });
    await assert.rejects(appendJsonLine(f.file, { n: 1 }, f.options()), (e) => e === failure);
    assert.deepEqual(await f.read(), [{ n: 1 }]);
    mock.mock.restore();
    await appendJsonLine(f.file, { n: 999 }, f.options());
    assert.deepEqual(await f.read(), [{ n: 1 }]);
    const receipt = decodeExecutionProjectionOutputRecord(await fs.readFile(f.receipt));
    assert.equal(receipt.sourceId, f.options().projection.sourceId);
  });
}

test("a failed partial UTF-8 write is completed from intent before an ordinary append", async (t) => {
  const f = await fixture(t);
  const failure = new Error("partial append");
  const open = fs.open.bind(fs);
  let injected = false;
  const mock = t.mock.method(fs, "open", async (target, ...options) => {
    const handle = await open(target, ...options);
    if (target === f.file && options[0] === "a+" && !injected) {
      injected = true;
      const write = handle.writeFile.bind(handle);
      handle.writeFile = async (bytes) => {
        await write(bytes.subarray(0, 8));
        throw failure;
      };
    }
    return handle;
  });
  await assert.rejects(
    appendJsonLine(f.file, { text: "中文🙂" }, f.options()),
    (e) => e === failure,
  );
  mock.mock.restore();
  await appendJsonLine(f.file, { ordinary: true });
  await appendJsonLine(f.file, { text: "ignored replay" }, f.options());
  assert.deepEqual(await f.read(), [{ text: "中文🙂" }, { ordinary: true }]);
});

test("a data sync failure never confirms the batch and recovery synchronizes the same bytes", async (t) => {
  const f = await fixture(t);
  const failure = new Error("data sync");
  const open = fs.open.bind(fs);
  const mock = t.mock.method(fs, "open", async (target, ...options) => {
    const handle = await open(target, ...options);
    if (target === f.file && options[0] === "a+")
      handle.sync = async () => {
        throw failure;
      };
    return handle;
  });
  await assert.rejects(appendJsonLine(f.file, { n: 1 }, f.options()), (e) => e === failure);
  mock.mock.restore();
  await appendJsonLine(f.file, { n: 1 }, f.options());
  assert.deepEqual(await f.read(), [{ n: 1 }]);
});

for (const afterRename of [false, true]) {
  test(`intent publication failure (${afterRename ? "after" : "before"} rename) remains recoverable`, async (t) => {
    const f = await fixture(t);
    const failure = new Error("intent publication");
    const rename = fs.rename.bind(fs);
    const mock = t.mock.method(fs, "rename", async (source, destination) => {
      if (!destination.endsWith(EXECUTION_PROJECTION_PENDING_SUFFIX))
        return rename(source, destination);
      if (afterRename) await rename(source, destination);
      throw failure;
    });
    await assert.rejects(appendJsonLine(f.file, { n: 1 }, f.options()), (e) => e === failure);
    mock.mock.restore();
    await appendJsonLine(f.file, { n: 1 }, f.options());
    assert.deepEqual(await f.read(), [{ n: 1 }]);
  });
}

test("intent retirement failure blocks later appends until its receipt can be recovered", async (t) => {
  const f = await fixture(t);
  const failure = new Error("intent retirement");
  const unlink = fs.unlink.bind(fs);
  const mock = t.mock.method(fs, "unlink", async (target) => {
    if (target.endsWith(EXECUTION_PROJECTION_PENDING_SUFFIX)) throw failure;
    return unlink(target);
  });
  await assert.rejects(appendJsonLine(f.file, { n: 1 }, f.options()), (e) => e === failure);
  await assert.rejects(appendJsonLine(f.file, { n: 2 }), (e) => e === failure);
  mock.mock.restore();
  await appendJsonLine(f.file, { n: 1 }, f.options());
  await appendJsonLine(f.file, { n: 2 });
  assert.deepEqual(await f.read(), [{ n: 1 }, { n: 2 }]);
});

test("a separate process can finish a lost receipt without re-appending", async (t) => {
  const f = await fixture(t);
  const moduleUrl = new URL("../src/transports/jsonl.js", import.meta.url).href;
  const script = `
    import fs from 'node:fs/promises';
    import { appendJsonLine } from ${JSON.stringify(moduleUrl)};
    const [file, options] = JSON.parse(process.argv[1]);
    const rename = fs.rename.bind(fs);
    fs.rename = async (source, destination) => {
      if (destination === options.projection.file) throw new Error('lost receipt');
      return rename(source, destination);
    };
    try { await appendJsonLine(file, { n: 1 }, options); process.exitCode = 2; }
    catch (error) { if (error.message !== 'lost receipt') throw error; }
  `;
  await promisify(execFile)(process.execPath, [
    "--import",
    new URL("../../shared/testing/runtime-params.js", import.meta.url).href,
    "--input-type=module",
    "-e",
    script,
    JSON.stringify([f.file, f.options()]),
  ]);
  await appendJsonLine(f.file, { n: 1 }, f.options());
  assert.deepEqual(await f.read(), [{ n: 1 }]);
});

test("rotation and retention do not erase source receipts or rotate replayed output", async (t) => {
  const f = await fixture(t);
  const extra = { maxFileBytes: 1, maxArchives: 1 };
  for (let n = 0; n < 4; n += 1) await appendJsonLine(f.file, { n }, f.options(n, extra));
  const before = (await fs.readdir(f.root)).sort();
  await appendJsonLine(f.file, { n: 0 }, f.options(0, extra));
  assert.deepEqual((await fs.readdir(f.root)).sort(), before);
  assert.deepEqual(await f.read(), [{ n: 3 }]);
  assert.equal(before.filter((name) => /^interaction\..*\.jsonl$/.test(name)).length, 1);
});

test("a same-batch duplicate cannot be acknowledged before the original is durable", async (t) => {
  const f = await fixture(t);
  const results = await Promise.allSettled([
    appendJsonLine(f.file, { n: 1 }, f.options()),
    appendJsonLine(f.file, { n: 1 }, f.options()),
  ]);
  assert.ok(results.every((result) => result.status === "rejected"));
  await assert.rejects(fs.stat(f.file), { code: "ENOENT" });
  await appendJsonLine(f.file, { n: 1 }, f.options());
  assert.deepEqual(await f.read(), [{ n: 1 }]);
});

test("a retired intent restored after restart cannot rewrite later ordinary output", async (t) => {
  const f = await fixture(t);
  const pending = `${f.file}${EXECUTION_PROJECTION_PENDING_SUFFIX}`;
  const unlink = fs.unlink.bind(fs);
  let retired;
  const mock = t.mock.method(fs, "unlink", async (target) => {
    if (target === pending) retired = await fs.readFile(target);
    return unlink(target);
  });
  await appendJsonLine(f.file, { n: 1 }, f.options());
  mock.mock.restore();
  assert.ok(retired);
  await appendJsonLine(f.file, { ordinary: true });
  const before = await fs.readFile(f.file);
  await fs.writeFile(pending, retired, { flush: true });
  const moduleUrl = new URL("../src/transports/projection-output.js", import.meta.url).href;
  await promisify(execFile)(process.execPath, [
    "--import",
    new URL("../../shared/testing/runtime-params.js", import.meta.url).href,
    "--input-type=module",
    "-e",
    `import { recoverProjectionOutput } from ${JSON.stringify(moduleUrl)};
     if (!(await recoverProjectionOutput(process.argv[1]))) throw new Error("missing intent");`,
    f.file,
  ]);
  assert.deepEqual(await fs.readFile(f.file), before);
  await assert.rejects(fs.stat(pending), { code: "ENOENT" });
  await appendJsonLine(f.file, { n: 2 }, f.options(1));
  assert.deepEqual(await f.read(), [{ n: 1 }, { ordinary: true }, { n: 2 }]);
});

test("corrupt pending bytes reject further writes instead of masking output damage", async (t) => {
  const f = await fixture(t);
  const failure = new Error("receipt unavailable");
  const rename = fs.rename.bind(fs);
  const mock = t.mock.method(fs, "rename", async (source, destination) => {
    if (destination === f.receipt) throw failure;
    return rename(source, destination);
  });
  await assert.rejects(appendJsonLine(f.file, { n: 1 }, f.options()), (e) => e === failure);
  mock.mock.restore();
  await fs.writeFile(f.file, '{"n":9}\n');
  await assert.rejects(appendJsonLine(f.file, { n: 2 }), /differs from its durable intent/);
  assert.equal(await fs.readFile(f.file, "utf8"), '{"n":9}\n');
});
