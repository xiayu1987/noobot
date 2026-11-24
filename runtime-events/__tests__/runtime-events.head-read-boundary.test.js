/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  PARTITION_JOURNAL_FRAME,
  PARTITION_JOURNAL_HEAD_FILE,
} from "@noobot/session-protocol/partition-journal";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { resolveWorkspaceSessionLocation } from "../src/session-location.js";
import { persistSession, tempRoot } from "./runtime-events-test-fixtures.js";

test("event location bounds head I/O and closes the descriptor before rejecting corruption", async (context) => {
  const workspaceRoot = await tempRoot();
  const sessionId = "bounded-head";
  const sessionDir = await persistSession(workspaceRoot, "admin", {
    sessionId,
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
  });
  const file = path.join(sessionDir, PARTITION_JOURNAL_HEAD_FILE);
  const original = await fs.readFile(file);
  const limit = PARTITION_JOURNAL_FRAME.controlBytes;
  await fs.writeFile(file, Buffer.alloc(limit * 32, 32));
  const readFile = fs.readFile.bind(fs);
  const open = fs.open.bind(fs);
  let total = 0;
  let closes = 0;
  context.mock.method(fs, "readFile", async (target, ...options) => {
    assert.notEqual(target, file, "head must not use unbounded readFile");
    return readFile(target, ...options);
  });
  context.mock.method(fs, "open", async (target, flags) => {
    const handle = await open(target, flags);
    if (target !== file) return handle;
    return {
      read: async (buffer, offset, length, position) => {
        const result = await handle.read(buffer, offset, Math.min(length, 31), position);
        total += result.bytesRead;
        return result;
      },
      close: async () => {
        closes += 1;
        await handle.close();
      },
    };
  });
  const location = { workspaceRoot, userId: "admin", sessionId };
  await assert.rejects(resolveWorkspaceSessionLocation(location), {
    code: "SESSION_STORAGE_CORRUPT",
  });
  assert.equal(total, limit + 1);
  assert.equal(closes, 1);
  await fs.writeFile(file, original);
  assert.deepEqual(await resolveWorkspaceSessionLocation(location), { sessionDir });
  assert.equal(closes, 2);
});
