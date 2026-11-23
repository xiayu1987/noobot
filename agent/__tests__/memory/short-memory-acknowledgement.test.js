/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MemoryManager } from "../../src/memory/index.js";
import { selectShortMemoryBatch } from "@noobot/memory-protocol/short-memory";

async function fixture(t) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "short-memory-ack-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const userId = "u1";
  const userRoot = path.join(workspaceRoot, userId);
  await mkdir(path.join(userRoot, "memory"), { recursive: true });
  const managers = [new MemoryManager({ workspaceRoot }), new MemoryManager({ workspaceRoot })];
  const capture = (sequence) =>
    managers[sequence % 2].captureDialogToShortMemory({
      userId,
      sessionId: `s${sequence}`,
      parentSessionId: "",
      dialogProcessId: "d1",
      messageRecords: [
        {
          ordinal: 1,
          message: {
            sessionId: `s${sequence}`,
            dialogProcessId: "d1",
            role: "user",
            content: "same content",
          },
        },
      ],
    });
  return { managers, userRoot, capture };
}

test("concurrent captures from separate managers do not overwrite each other", async (t) => {
  const { managers, userRoot, capture } = await fixture(t);
  await Promise.all(Array.from({ length: 12 }, (_, index) => capture(index)));
  const items = await managers[0].shortMemory.readItems(userRoot);
  assert.equal(items.length, 12);
  assert.equal(new Set(items.map((item) => item.captureId)).size, 12);
  assert.equal(new Set(items.map((item) => item.sessionId)).size, 12);
});

test("snapshot acknowledgement is retryable and cannot remove later captures", async (t) => {
  const { managers, userRoot, capture } = await fixture(t);
  await capture(0);
  const processed = selectShortMemoryBatch(await managers[0].shortMemory.readItems(userRoot), {
    maxItems: 10,
    maxChars: 1024,
  }).entries;
  await Promise.all([managers[0].shortMemory.acknowledgeBatch(userRoot, processed), capture(1)]);
  assert.deepEqual(
    (await managers[0].shortMemory.readItems(userRoot)).map((item) => item.sessionId),
    ["s1"],
  );
  assert.deepEqual(await managers[1].shortMemory.acknowledgeBatch(userRoot, processed), {
    deletedCount: 0,
  });
  assert.equal((await managers[0].shortMemory.readItems(userRoot)).length, 1);
});
