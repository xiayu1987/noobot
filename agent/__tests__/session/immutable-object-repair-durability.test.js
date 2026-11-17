/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, open, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { ImmutableObjectStore } from "../../src/session/session-artifact-session/immutable-object-store.js";
import { restoreImmutableObjects } from "../../src/session/session-artifact-session/immutable-object-repair.js";
import { sessionMutationCoordinator } from "../../src/session/session-mutation-coordinator.js";
import { resetFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";

for (const stage of ["object-shard", "objects", "session"]) {
  test(`repair retry completes durability after ${stage} sync failure without rewriting objects`, async (t) => {
    const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-repair-durability-"));
    t.after(() => rm(sessionDir, { recursive: true, force: true }));
    const store = new ImmutableSessionStore({
      sessionDir,
      sessionId: "repair",
      allowCreate: true,
      objectStore: ImmutableObjectStore,
    });
    await store.commit({
      expectedGeneration: 0,
      operationId: "seed",
      changes: [{ collection: "messages", key: "message", value: { content: "original" } }],
    });
    const snapshot = await store.snapshot();
    const root = await store.index.get(snapshot.root, "messages");
    const reference = await store.index.get(root, "message");
    const file = store.objects.objectPath(reference);
    const bytes = await readFile(file);
    const head = await readFile(store.headPath);
    await rm(file);
    const directories = [path.dirname(file), store.objects.directory, sessionDir];
    const failingDirectory = directories[["object-shard", "objects", "session"].indexOf(stage)];
    const synced = [];
    let fail = true;
    let replacements = 0;
    const failure = Object.assign(new Error(`injected ${stage} sync failure`), { code: "EIO" });
    setFsAdapter({
      rename: async (source, target) => {
        if (target === file) replacements += 1;
        return rename(source, target);
      },
      open: async (target, flags) => {
        const handle = await open(target, flags);
        return new Proxy(handle, {
          get(object, key) {
            if (key === "sync" && flags === "r" && directories.includes(target)) {
              return async () => {
                if (fail && target === failingDirectory) throw failure;
                await object.sync();
                synced.push(target);
              };
            }
            const value = Reflect.get(object, key, object);
            return typeof value === "function" ? value.bind(object) : value;
          },
        });
      },
    });
    const repair = () =>
      sessionMutationCoordinator.run(store.lockPath, () =>
        restoreImmutableObjects({
          sessionDir,
          objectStore: ImmutableObjectStore,
          replacements: new Map([[reference, bytes]]),
        }),
      );
    try {
      await assert.rejects(repair(), (error) => error === failure);
      assert.deepEqual(await readFile(file), bytes, "rename already published matching bytes");

      await assert.rejects(repair(), (error) => error === failure);
      fail = false;
      synced.length = 0;
      const restored = await repair();
      assert.deepEqual(restored, []);
      assert.deepEqual(synced, directories);
      assert.equal(replacements, 1);
      assert.deepEqual(await readFile(store.headPath), head);
      assert.deepEqual(await store.get(snapshot, "messages", "message"), { content: "original" });
    } finally {
      resetFsAdapter();
    }
  });
}
