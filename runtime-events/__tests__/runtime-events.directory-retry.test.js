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
import { appendJsonLine } from "../src/transports/jsonl.js";

for (const level of ["turn", "session", "root"]) {
  test(`directory preparation retries the complete durability boundary after ${level} sync failure`, async (t) => {
    t.mock.property(process, "platform", PLATFORM.LINUX);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-event-directory-retry-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const session = path.join(root, "session");
    const turn = path.join(session, "turn");
    const file = path.join(turn, "events.jsonl");
    const directories = { root, session, turn };
    const failure = new Error("injected directory preparation failure");
    const open = fs.open.bind(fs);
    const synced = [];
    let fail = true;
    t.mock.method(fs, "open", async (target, ...options) => {
      if (Object.values(directories).includes(target)) {
        assert.equal(options[0], "r");
        return {
          async sync() {
            synced.push(target);
            if (fail && target === directories[level]) throw failure;
          },
          async close() {},
        };
      }
      return open(target, ...options);
    });
    await assert.rejects(appendJsonLine(file, { n: 1 }), (error) => error === failure);
    await assert.rejects(fs.stat(file), { code: "ENOENT" });
    fail = false;
    synced.length = 0;
    await appendJsonLine(file, { n: 2 });
    assert.deepEqual(synced, [turn, session, root, turn]);
    assert.deepEqual((await fs.readFile(file, "utf8")).trim(), '{"n":2}');
    synced.length = 0;
    await appendJsonLine(file, { n: 3 });
    assert.deepEqual(synced, []);
    assert.equal((await fs.readFile(file, "utf8")).trim().split("\n").length, 2);
  });
}
