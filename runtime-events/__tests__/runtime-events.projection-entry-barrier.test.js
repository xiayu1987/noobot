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
import { PLATFORM } from "@noobot/platform-compatibility/platform";
import {
  executionLogProjectionIdentity,
  EXECUTION_PROJECTION_PENDING_SUFFIX,
} from "@noobot/session-protocol";
import {
  publishProjectionOutput,
  recoverProjectionOutput,
} from "../src/transports/projection-output.js";
import { appendJsonLine } from "../src/transports/jsonl.js";

test("locked publication reads each receipt once and still rejects replayed output", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "projection-selection-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "output.jsonl");
  const receipt = path.join(root, "receipt.json");
  const options = (offset) => ({
    projection: { file: receipt, sourceId: executionLogProjectionIdentity("d1", 1, offset) },
  });
  await appendJsonLine(file, { n: 1 }, options(0));
  const open = fs.open.bind(fs);
  let receiptReads = 0;
  const mock = t.mock.method(fs, "open", async (target, ...flags) => {
    if (target === receipt && flags[0] === "r") receiptReads += 1;
    return open(target, ...flags);
  });
  await appendJsonLine(file, { n: 2 }, options(1));
  assert.equal(receiptReads, 1);
  const replay = await appendJsonLine(file, { n: 999 }, options(1));
  assert.equal(replay.duplicate, true);
  assert.equal(receiptReads, 2);
  mock.mock.restore();
  assert.deepEqual((await fs.readFile(file, "utf8")).trim().split("\n").map(JSON.parse), [
    { n: 1 },
    { n: 2 },
  ]);
});

for (const failEntryBarrier of [false, true]) {
  test(`output entry and intent share a barrier; failure=${failEntryBarrier}`, async (t) => {
    t.mock.property(process, "platform", PLATFORM.LINUX);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "projection-entry-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const file = path.join(root, "output.jsonl");
    const receipt = path.join(root, "receipt.json");
    const pending = `${file}${EXECUTION_PROJECTION_PENDING_SUFFIX}`;
    const line = '{"n":1}\n';
    const entries = [
      {
        line,
        options: {
          projection: { file: receipt, sourceId: executionLogProjectionIdentity("d1", 1, 0) },
        },
      },
    ];
    const open = fs.open.bind(fs);
    let barriers = 0;
    let outputSynced = false;
    const failure = new Error("entry barrier failed");
    t.mock.method(fs, "open", async (target, ...flags) => {
      const handle =
        target === root ? { async sync() {}, async close() {} } : await open(target, ...flags);
      const sync = handle.sync.bind(handle);
      if (target === file)
        handle.sync = async () => {
          assert.ok(barriers >= 1);
          await sync();
          outputSynced = true;
        };
      if (target === root)
        handle.sync = async () => {
          barriers += 1;
          if (barriers === 1) {
            assert.equal((await fs.stat(file)).size, 0);
            assert.ok((await fs.stat(pending)).size > 0);
            await assert.rejects(fs.stat(receipt), { code: "ENOENT" });
            if (failEntryBarrier) throw failure;
          } else assert.equal(outputSynced, true);
          return sync();
        };
      return handle;
    });
    if (failEntryBarrier) {
      await assert.rejects(publishProjectionOutput(file, entries, 0), (error) => error === failure);
      assert.equal(outputSynced, false);
      await assert.rejects(fs.stat(receipt), { code: "ENOENT" });
    } else {
      await publishProjectionOutput(file, entries, 0);
      assert.equal(barriers, 2, "entry and durable receipt barriers complete publication");
    }
    t.mock.restoreAll();
    if (failEntryBarrier) {
      await fs.unlink(file);
      await recoverProjectionOutput(file);
    }
    assert.equal(await fs.readFile(file, "utf8"), line);
    await assert.rejects(fs.stat(pending), { code: "ENOENT" });
  });
}

test("output open failure publishes neither intent nor receipt", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "projection-open-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "output.jsonl");
  const receipt = path.join(root, "receipt.json");
  const open = fs.open.bind(fs);
  const failure = new Error("output open failed");
  const mock = t.mock.method(fs, "open", async (target, ...flags) => {
    if (target === file) throw failure;
    return open(target, ...flags);
  });
  await assert.rejects(
    publishProjectionOutput(
      file,
      [
        {
          line: "{}\n",
          options: {
            projection: { file: receipt, sourceId: executionLogProjectionIdentity("d1", 1, 0) },
          },
        },
      ],
      0,
    ),
    (error) => error === failure,
  );
  mock.mock.restore();
  await assert.rejects(fs.stat(receipt), { code: "ENOENT" });
  await assert.rejects(fs.stat(`${file}${EXECUTION_PROJECTION_PENDING_SUFFIX}`), {
    code: "ENOENT",
  });
});
