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
import { normalizePlatform, PLATFORM } from "@noobot/platform-compatibility/platform";
import { appendJsonLine } from "../src/transports/jsonl.js";

test("group receipt waits for flushed data and host-supported directory synchronization", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-event-durability-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "events.jsonl");
  const events = [];
  const append = fs.appendFile.bind(fs);
  const windows = normalizePlatform(process.platform) === PLATFORM.WINDOWS;
  const open = fs.open.bind(fs);
  t.mock.method(fs, "appendFile", async (target, data, options) => {
    assert.equal(options.flush, true);
    await append(target, data, options);
    events.push("data-synced");
  });
  t.mock.method(fs, "open", async (target, ...options) => {
    if (target === root) assert.equal(windows, false);
    const handle = await open(target, ...options);
    if (target === root) {
      const sync = handle.sync.bind(handle);
      handle.sync = async () => {
        await sync();
        events.push("directory-synced");
      };
    }
    return handle;
  });
  await Promise.all([appendJsonLine(file, { n: 1 }), appendJsonLine(file, { n: 2 })]);
  events.push("acknowledged");
  assert.deepEqual(
    events,
    windows ? ["data-synced", "acknowledged"] : ["data-synced", "directory-synced", "acknowledged"],
  );
});

test("directory sync failure rejects every receipt and releases the append queue", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-event-sync-failure-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "events.jsonl");
  const failure = new Error("directory sync failed");
  t.mock.property(process, "platform", PLATFORM.LINUX);
  const open = fs.open.bind(fs);
  let fail = true;
  let closed = 0;
  t.mock.method(fs, "open", async (target, ...options) => {
    if (target !== root) return open(target, ...options);
    assert.equal(options[0], "r");
    return {
      async sync() {
        if (fail) throw failure;
      },
      async close() {
        closed += 1;
      },
    };
  });
  const results = await Promise.allSettled([
    appendJsonLine(file, { n: 1 }),
    appendJsonLine(file, { n: 2 }),
  ]);
  assert.ok(results.every((result) => result.status === "rejected" && result.reason === failure));
  assert.equal(closed, 1);
  fail = false;
  await appendJsonLine(file, { n: 3 });
  assert.equal(closed, 2);
});
