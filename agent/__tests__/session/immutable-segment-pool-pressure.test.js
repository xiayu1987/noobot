/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableSegmentStore } from "../../src/session/session-artifact-session/immutable-segment-store.js";
import { IMMUTABLE_SEGMENT } from "@noobot/session-protocol/immutable-segment";

for (const failClose of [false, true]) {
  test(`active segment leases survive budget pressure and all close${failClose ? " with close errors propagated" : ""}`, async (t) => {
    const directory = await mkdtemp(path.join(tmpdir(), "segment-pool-pressure-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const store = new ImmutableSegmentStore(directory);
    const count = IMMUTABLE_SEGMENT.transactionReadHandles + 1;
    const references = [];
    for (let i = 0; i < count; i += 1) {
      const batch = store.createBatch();
      const reference = batch.stage(Buffer.from(`record-${i}`));
      await batch.publish([reference]);
      references.push(reference);
    }
    const admitted = Promise.withResolvers();
    const release = Promise.withResolvers();
    let reads = 0;
    let closes = 0;
    const failure = new Error("excess active lease close failed");
    const open = store.openReadSegment.bind(store);
    store.openReadSegment = async (...args) => {
      const opened = await open(...args);
      const read = opened.handle.read.bind(opened.handle);
      const close = opened.handle.close.bind(opened.handle);
      opened.handle.read = async (...readArgs) => {
        reads += 1;
        if (reads === count * 2) admitted.resolve();
        await release.promise;
        return read(...readArgs);
      };
      opened.handle.close = async () => {
        const index = closes++;
        await close();
        if (failClose && index === 0) throw failure;
      };
      return opened;
    };
    await store.withReadScope(async () => {
      const pending = Promise.allSettled(
        references.flatMap((reference) => [store.read(reference), store.read(reference)]),
      );
      try {
        await admitted.promise;
        assert.equal(store.readScopes.getStore().handles.size, count);
        assert.equal(closes, 0, "active descriptors must never be evicted");
      } finally {
        release.resolve();
      }
      const results = await pending;
      assert.equal(
        store.readScopes.getStore().handles.size,
        IMMUTABLE_SEGMENT.transactionReadHandles,
      );
      assert.equal(closes, 1);
      const rejected = results.filter((result) => result.status === "rejected");
      assert.equal(rejected.length, failClose ? 1 : 0);
      if (failClose) assert.equal(rejected[0].reason.cause, failure);
    });
    assert.equal(closes, count);
  });
}
