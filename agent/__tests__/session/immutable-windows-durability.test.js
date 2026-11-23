/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, open, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";

test(
  "Windows session creation and reopen retain file sync without directory handles",
  { skip: process.platform !== "win32" && "requires native Windows filesystem" },
  async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "immutable-windows-durability-"));
    context.after(() => rm(directory, { recursive: true, force: true }));
    context.after(resetFsAdapter);
    const synchronized = [];
    setFsAdapter({
      open: async (file, flags, mode) => {
        if (flags === "r" && (await stat(file)).isDirectory())
          throw Object.assign(new Error("Windows directory fsync is unsupported"), {
            code: "EPERM",
          });
        const handle = await open(file, flags, mode);
        const sync = handle.sync.bind(handle);
        handle.sync = async () => {
          await sync();
          synchronized.push(String(file));
        };
        return handle;
      },
    });
    const sessionDir = path.join(directory, "session");
    const store = new ImmutableSessionStore({
      sessionDir,
      sessionId: "windows",
      allowCreate: true,
    });
    await store.commit({
      expectedGeneration: 0,
      operationId: "create",
      changes: [{ collection: "metadata", key: "value", value: 1 }],
    });
    assert.ok(synchronized.some((file) => path.basename(file).includes(".seg.")));
    assert.ok(synchronized.some((file) => path.basename(file).startsWith("head.json.")));
    const reopened = await ImmutableSessionStore.open({ sessionDir });
    assert.equal(await reopened.get(await reopened.snapshot(), "metadata", "value"), 1);
  },
);
