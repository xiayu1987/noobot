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

for (const failedParent of [null, "objects", "session"]) {
  test(`multi-object repair batches parent syncs and retries ${failedParent ?? "success"}`, async (t) => {
    const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-repair-batch-"));
    t.after(() => rm(sessionDir, { recursive: true, force: true }));
    const store = new ImmutableSessionStore({
      sessionDir,
      sessionId: "batch",
      allowCreate: true,
      objectStore: ImmutableObjectStore,
    });
    await store.commit({
      expectedGeneration: 0,
      operationId: "seed",
      changes: Array.from({ length: 4 }, (_, index) => ({
        collection: "messages",
        key: `message-${index}`,
        value: { content: `original-${index}` },
      })),
    });
    const head = await readFile(store.headPath);
    const snapshot = await store.snapshot();
    const root = await store.index.get(snapshot.root, "messages");
    const replacements = [];
    const files = [];
    for await (const [, reference] of store.index.entries(root)) {
      const file = store.objects.objectPath(reference);
      files.push(file);
      replacements.push({ reference, bytes: await readFile(file) });
      await rm(file);
    }
    const parents = [store.objects.directory, sessionDir];
    const failingDirectory = failedParent === "objects" ? parents[0] : parents[1];
    const failure = Object.assign(new Error("batch parent sync failed"), { code: "EIO" });
    let fail = failedParent !== null;
    let writes = 0;
    const synced = [];
    setFsAdapter({
      rename: async (source, target) => {
        if (files.includes(target)) writes += 1;
        return rename(source, target);
      },
      open: async (target, flags) => {
        const handle = await open(target, flags);
        return new Proxy(handle, {
          get(object, key) {
            if (key === "sync" && flags === "r") {
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
          replacements: new Map(replacements.map(({ reference, bytes }) => [reference, bytes])),
        }),
      );
    try {
      if (fail) {
        await assert.rejects(repair(), (error) => error === failure);
        assert.equal(writes, replacements.length, "all objects precede the parent barrier");
        await assert.rejects(repair(), (error) => error === failure);
        fail = false;
        synced.length = 0;
      }
      const result = await repair();
      assert.equal(result.length, failedParent === null ? replacements.length : 0);
      assert.equal(writes, replacements.length, "retry must not rewrite restored objects");
      assert.deepEqual(
        synced.filter((directory) => parents.includes(directory)),
        parents,
      );
      assert.deepEqual(synced.slice(-2), parents, "parent barriers follow all shard syncs");
      assert.equal(synced.length, replacements.length + 2);
      assert.deepEqual(await readFile(store.headPath), head);
      for (let index = 0; index < files.length; index += 1)
        assert.deepEqual(await readFile(files[index]), replacements[index].bytes);
    } finally {
      resetFsAdapter();
    }
  });
}
