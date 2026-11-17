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
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { ImmutableObjectStore } from "../../src/session/session-artifact-session/immutable-object-store.js";
import { resetFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";

for (const fail of [false, true]) {
  test(`publication drains bounded parallel shard barriers before ${fail ? "rejecting" : "syncing parents"}`, async (t) => {
    const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-publication-barrier-"));
    t.after(() => rm(sessionDir, { recursive: true, force: true }));
    const objects = new ImmutableObjectStore(sessionDir);
    const limit = QUANTITY_THRESHOLDS.immutableStorage.recordIoConcurrency;
    const started = Promise.withResolvers();
    const release = Promise.withResolvers();
    const failure = new Error("shard sync failed");
    const parents = [];
    let active = 0;
    let peak = 0;
    let synced = 0;
    let settled = false;
    setFsAdapter({
      open: async (file, flags) => {
        const handle = await open(file, flags);
        if (flags !== "r") return handle;
        return new Proxy(handle, {
          get(target, key) {
            if (key === "sync")
              return async () => {
                if (path.dirname(file) !== objects.directory) {
                  assert.equal(active, 0, "parents cannot pass in-flight shard barriers");
                  parents.push(file);
                  return target.sync();
                }
                active += 1;
                peak = Math.max(peak, active);
                if (active === limit) started.resolve();
                const shouldFail = fail && peak === 1;
                try {
                  await release.promise;
                  if (shouldFail) throw failure;
                  await target.sync();
                  synced += 1;
                } finally {
                  active -= 1;
                }
              };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    });
    const shards = new Set();
    const publication = objects.withDurabilityBatch(async () => {
      const roots = [];
      for (let index = 0; index < limit * 4; index += 1) {
        const reference = await objects.put(Buffer.from(`barrier-${index}`));
        shards.add(path.dirname(objects.objectPath(reference)));
        roots.push(reference);
      }
      await objects.publishReachable(roots);
    });
    const outcome = publication.then(
      () => {
        settled = true;
        return null;
      },
      (error) => {
        settled = true;
        return error;
      },
    );
    try {
      await Promise.race([started.promise, outcome]);
      assert.equal(peak, limit, "independent shards must use the bounded worker pool");
      assert.equal(settled, false);
      assert.deepEqual(parents, []);
    } finally {
      release.resolve();
      await outcome;
      resetFsAdapter();
    }
    assert.equal(active, 0, "no I/O may outlive its durability batch");
    assert.ok(peak <= limit);
    if (fail) {
      assert.equal(await outcome, failure);
      assert.deepEqual(parents, []);
    } else {
      assert.equal(await outcome, null);
      assert.equal(synced, shards.size);
      assert.deepEqual(parents, [objects.directory, sessionDir]);
    }
  });
}
