/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { PLATFORM } from "@noobot/platform-compatibility/platform";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { appendJsonLine } from "../src/transports/jsonl.js";

test("failed directory preparations have bounded admission and keep their complete retry boundary", async (t) => {
  t.mock.property(process, "platform", PLATFORM.LINUX);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-directory-capacity-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const failure = new Error("directory sync failed");
  let fail = true;
  let creates = 0;
  const synced = [];
  t.mock.method(fs, "mkdir", async (directory) => {
    creates += 1;
    return directory;
  });
  const open = fs.open.bind(fs);
  t.mock.method(fs, "open", async (directory, ...options) =>
    directory.endsWith(".json")
      ? open(directory, ...options)
      : {
          async sync() {
            synced.push(directory);
            if (fail) throw failure;
          },
          async close() {},
        },
  );
  t.mock.method(fs, "appendFile", async () => {});
  const file = (index) => path.join(root, String(index), "events.jsonl");
  const budget = QUANTITY_THRESHOLDS.runtimeEvents.maxCachedFiles;
  for (let index = 0; index < budget; index += 1)
    await assert.rejects(appendJsonLine(file(index), { index }), (error) => error === failure);
  await assert.rejects(appendJsonLine(file(budget), { index: budget }), {
    code: "RUNTIME_EVENT_DIRECTORY_BACKPRESSURE_REQUIRED",
  });
  assert.equal(creates, budget);
  fail = false;
  synced.length = 0;
  await appendJsonLine(file(0), { recovered: true });
  assert.deepEqual(synced, [path.dirname(file(0)), root, path.dirname(file(0))]);
  assert.equal(creates, budget);
  await appendJsonLine(file(budget), { index: budget });
  assert.equal(creates, budget + 1);
});
