/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";

test("ordinary commits do not synchronize the session parent and retain their durability barriers", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "immutable-directory-durability-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sessionDir = path.join(directory, "session");
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "s1", allowCreate: true });
  await store.commit({
    expectedGeneration: 0,
    operationId: "create",
    changes: [{ collection: "metadata", key: "value", value: 1 }],
  });
  const synchronized = [];
  setFsAdapter({
    open: async (file, flags) => {
      assert.notEqual(String(file), directory, "the committed parent needs no further sync");
      const handle = await open(file, flags);
      return new Proxy(handle, {
        get(target, key) {
          if (key === "sync")
            return async () => {
              await target.sync();
              synchronized.push(String(file));
            };
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  });
  try {
    await store.commit({
      expectedGeneration: 1,
      operationId: "append",
      changes: [{ collection: "metadata", key: "value", value: 2 }],
    });
  } finally {
    resetFsAdapter();
  }
  assert.ok(synchronized.some((file) => file.endsWith(".seg")));
  assert.ok(synchronized.some((file) => path.basename(file).startsWith("head.json.")));
  assert.equal(synchronized.at(-1), sessionDir);
  const reopened = await ImmutableSessionStore.open({ sessionDir });
  assert.equal((await reopened.snapshot()).generation, 2);
  assert.equal(await reopened.get(await reopened.snapshot(), "metadata", "value"), 2);
});
