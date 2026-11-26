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
import { syncOutputDirectory } from "../src/transports/projection-output.js";

for (const failed of [false, true]) {
  test(`directory barriers share admitted requests and isolate later writes; failure=${failed}`, async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "directory-sync-batch-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    t.mock.property(process, "platform", PLATFORM.LINUX);
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const failure = new Error("directory sync failed");
    let barriers = 0;
    let closes = 0;
    const mock = t.mock.method(fs, "open", async (target, flags) => {
      assert.equal(target, root);
      assert.equal(flags, "r");
      return {
        async sync() {
          const ordinal = ++barriers;
          if (ordinal === 1) {
            entered.resolve();
            await release.promise;
            if (failed) throw failure;
          }
        },
        async close() {
          closes += 1;
        },
      };
    });
    const first = syncOutputDirectory(root);
    const shared = syncOutputDirectory(path.join(root, "."));
    assert.equal(first, shared);
    const completed = Promise.allSettled([first, shared]);
    await entered.promise;
    assert.equal(barriers, 1);
    await fs.writeFile(path.join(root, "later"), "later directory entry");
    const later = syncOutputDirectory(root);
    assert.notEqual(later, first);
    try {
      await later;
      assert.equal(barriers, 2);
    } finally {
      release.resolve();
    }
    const results = await completed;
    for (const result of results) {
      assert.equal(result.status, failed ? "rejected" : "fulfilled");
      if (failed) assert.equal(result.reason, failure);
    }
    assert.equal(closes, 2);
    await syncOutputDirectory(root);
    assert.equal(barriers, 3);
    assert.equal(closes, 3);
    mock.mock.restore();
  });
}

test("directory open failures reject every admitted caller and allow retry", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "directory-sync-open-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const failure = new Error("directory open failed");
  t.mock.property(process, "platform", PLATFORM.LINUX);
  let attempts = 0;
  t.mock.method(fs, "open", async (target, flags) => {
    assert.equal(target, root);
    assert.equal(flags, "r");
    if (++attempts === 1) throw failure;
    return { sync: async () => {}, close: async () => {} };
  });
  const results = await Promise.allSettled([syncOutputDirectory(root), syncOutputDirectory(root)]);
  assert.ok(results.every((result) => result.status === "rejected" && result.reason === failure));
  await syncOutputDirectory(root);
  assert.equal(attempts, 2);
});
