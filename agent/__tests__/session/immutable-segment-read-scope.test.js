/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableSegmentStore } from "../../src/session/session-artifact-session/immutable-segment-store.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import {
  decodeImmutableRecordReference,
  IMMUTABLE_SEGMENT,
} from "@noobot/session-protocol/immutable-segment";

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "segment-read-scope-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  t.after(resetFsAdapter);
  const store = new ImmutableSegmentStore(directory);
  const batch = store.createBatch();
  const references = [batch.stage(Buffer.from("first")), batch.stage(Buffer.from("second"))];
  await batch.publish(references);
  let opens = 0;
  let closes = 0;
  setFsAdapter({
    open: async (...args) => {
      const handle = await open(...args);
      opens += 1;
      const close = handle.close.bind(handle);
      handle.close = async () => {
        closes += 1;
        return close();
      };
      return handle;
    },
  });
  return { store, references, counts: () => ({ opens, closes }) };
}

test("one transaction shares a segment descriptor across concurrent record reads and releases it", async (t) => {
  const { store, references, counts } = await fixture(t);
  await store.withReadScope(async () => {
    const bytes = await Promise.all(references.map((reference) => store.read(reference)));
    assert.deepEqual(
      bytes.map((value) => value.toString()),
      ["first", "second"],
    );
    assert.deepEqual(counts(), { opens: 1, closes: 0 });
  });
  assert.deepEqual(counts(), { opens: 1, closes: 1 });
  await store.withReadScope(() => store.read(references[0]));
  assert.deepEqual(counts(), { opens: 2, closes: 2 });
});

test("failed transaction releases descriptors and preserves the original failure", async (t) => {
  const { store, references, counts } = await fixture(t);
  const failure = new Error("transaction failed");
  await assert.rejects(
    store.withReadScope(async () => {
      await store.read(references[0]);
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.deepEqual(counts(), { opens: 1, closes: 1 });
});

test("read scope never caches record bytes and detects corruption within an open segment", async (t) => {
  const { store, references, counts } = await fixture(t);
  const record = decodeImmutableRecordReference(references[0]);
  await assert.rejects(
    store.withReadScope(async () => {
      await store.read(references[0]);
      const handle = await open(store.segmentPath(record.segmentId), "r+");
      try {
        await handle.write(Buffer.from("bad!!"), 0, record.length, record.offset);
      } finally {
        await handle.close();
      }
      await store.read(references[0]);
    }),
    { code: "SESSION_IMMUTABLE_STORAGE_INVALID" },
  );
  assert.deepEqual(counts(), { opens: 1, closes: 1 });
});

test("missing segment errors remain storage errors and close the scope without a second error", async (t) => {
  const { store, references } = await fixture(t);
  const record = decodeImmutableRecordReference(references[0]);
  await rm(store.segmentPath(record.segmentId));
  await assert.rejects(
    store.withReadScope(() => store.read(references[0])),
    {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    },
  );
});

for (const operationFails of [false, true]) {
  for (const failingCloses of [1, 2]) {
    test(`read scope reports ${failingCloses} close failures after ${operationFails ? "failed" : "successful"} reads and releases every descriptor`, async (t) => {
      const { store, references } = await fixture(t);
      resetFsAdapter();
      const batch = store.createBatch();
      const other = batch.stage(Buffer.from("other segment"));
      await batch.publish([other]);
      const operationFailure = new Error("read operation failed");
      const closeFailures = Array.from(
        { length: failingCloses },
        (_, index) => new Error(`close ${index} failed`),
      );
      let closed = 0;
      setFsAdapter({
        open: async (...args) => {
          const handle = await open(...args);
          const close = handle.close.bind(handle);
          handle.close = async () => {
            const index = closed++;
            await close();
            if (index < failingCloses) throw closeFailures[index];
          };
          return handle;
        },
      });
      await assert.rejects(
        store.withReadScope(async () => {
          await Promise.all([store.read(references[0]), store.read(other)]);
          if (operationFails) throw operationFailure;
        }),
        (error) => {
          let cleanupFailure = error;
          if (operationFails) {
            assert.equal(error.cause, operationFailure);
            assert.equal(error.errors[0], operationFailure);
            cleanupFailure = error.errors[1];
          }
          if (failingCloses === 1) assert.equal(cleanupFailure, closeFailures[0]);
          else assert.deepEqual(cleanupFailure.errors, closeFailures);
          return true;
        },
      );
      assert.equal(closed, 2);
      resetFsAdapter();
      await store.withReadScope(() => store.read(other));
    });
  }
}

for (const failClose of [false, true]) {
  test(`handle pool evicts an idle descriptor${failClose ? " and surfaces its close failure" : " and shares the replacement across concurrent reads"}`, async (t) => {
    const { store, references } = await fixture(t);
    resetFsAdapter();
    const groups = [references];
    for (let i = 0; i < IMMUTABLE_SEGMENT.transactionReadHandles; i += 1) {
      const batch = store.createBatch();
      const group = [
        batch.stage(Buffer.from(`first-${i}`)),
        batch.stage(Buffer.from(`second-${i}`)),
      ];
      await batch.publish(group);
      groups.push(group);
    }
    let opens = 0;
    let closes = 0;
    const closeFailure = new Error("eviction close failed");
    const openSegment = store.openReadSegment.bind(store);
    store.openReadSegment = async (...args) => {
      const opened = await openSegment(...args);
      const evicted = opens++ === 0;
      const close = opened.handle.close.bind(opened.handle);
      opened.handle.close = async () => {
        closes += 1;
        await close();
        if (failClose && evicted) throw closeFailure;
      };
      return opened;
    };
    const operation = store.withReadScope(async () => {
      for (const [reference] of groups.slice(0, -1)) await store.read(reference);
      const requested = Array.from({ length: 8 }, (_, i) => groups.at(-1)[i % 2]);
      const results = await Promise.allSettled(requested.map((reference) => store.read(reference)));
      assert.equal(opens, IMMUTABLE_SEGMENT.transactionReadHandles + (failClose ? 0 : 1));
      assert.equal(closes, 1);
      if (failClose) {
        const failures = results.filter((result) => result.status === "rejected");
        assert.equal(failures.length, requested.length);
        assert.equal(failures[0].reason.cause, closeFailure);
        throw failures[0].reason;
      }
      assert.equal(
        results.filter((result) => result.status === "fulfilled").length,
        requested.length,
      );
      assert.equal(
        store.readScopes.getStore().handles.size,
        IMMUTABLE_SEGMENT.transactionReadHandles,
      );
    });
    if (failClose) await assert.rejects(operation, { code: "SESSION_IMMUTABLE_STORAGE_INVALID" });
    else await operation;
    assert.equal(closes, opens);
  });
}
