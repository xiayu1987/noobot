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
import { ImmutableLocatedRecordStore } from "../../src/session/session-artifact-session/immutable-located-record-store.js";
import { IMMUTABLE_LOCATED_SESSION_FORMAT } from "@noobot/session-protocol/immutable-record-location";
import { IMMUTABLE_TRANSACTION_READ_CACHE } from "@noobot/session-protocol/immutable-storage-graph";
import { decodeImmutableRecordReference } from "@noobot/session-protocol/immutable-segment";

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "immutable-read-cache-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return new ImmutableLocatedRecordStore(directory);
}

test("recently read entries survive record and byte budget eviction", async (t) => {
  const store = await fixture(t);
  for (const [size, count] of [
    [1, IMMUTABLE_TRANSACTION_READ_CACHE.records],
    [IMMUTABLE_TRANSACTION_READ_CACHE.bytes / 2, 2],
  ]) {
    let scope;
    await store.withReadScope(async () => {
      scope = store.reads.getStore();
      for (let slot = 0; slot < count; slot += 1)
        store.rememberRead(scope, `entry-${slot}`, { size, slot });
      assert.equal(
        (await store.readScopedEntry("entry-0", () => assert.fail("cache miss"))).slot,
        0,
      );
      store.rememberRead(scope, "new-entry", { size });
      assert.equal(scope.records.has("entry-0"), true);
      assert.equal(scope.records.has("entry-1"), false);
      assert.ok(scope.bytes <= IMMUTABLE_TRANSACTION_READ_CACHE.bytes);
      assert.ok(scope.records.size <= IMMUTABLE_TRANSACTION_READ_CACHE.records);
    });
    assert.equal(scope.active, false);
    assert.equal(scope.records.size, 0);
    assert.equal(scope.bytes, 0);
  }
});

test("concurrent cache misses share a load, propagate failure, and allow a verified retry", async (t) => {
  const store = await fixture(t);
  let scope;
  const failure = new Error("record read failed");
  await assert.rejects(
    store.withReadScope(async () => {
      scope = store.reads.getStore();
      let reject;
      let loads = 0;
      const load = () => {
        loads += 1;
        return new Promise((_resolve, rejectLoad) => {
          reject = rejectLoad;
        });
      };
      const first = store.readScopedEntry("record", load);
      const second = store.readScopedEntry("record", load);
      await Promise.resolve();
      assert.equal(loads, 1);
      reject(failure);
      const results = await Promise.allSettled([first, second]);
      assert.ok(
        results.every((result) => result.status === "rejected" && result.reason === failure),
      );
      assert.equal(scope.records.size, 0);
      assert.equal(scope.bytes, 0);
      const verified = { bytes: Buffer.from("verified"), size: 8 };
      assert.equal(await store.readScopedEntry("record", () => verified), verified);
      assert.equal(scope.records.size, 0);
      store.rememberRead(scope, "record", verified);
      assert.equal(
        await store.readScopedEntry("record", () => assert.fail("cache miss")),
        verified,
      );
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.equal(scope.records.size, 0);
  assert.equal(scope.bytes, 0);
  assert.equal(scope.active, false);
});

test("location pages retain only their frozen decoded representation and deduplicate concurrent reads", async (t) => {
  const store = await fixture(t);
  const empty = {
    format: IMMUTABLE_LOCATED_SESSION_FORMAT,
    generation: 0,
    ...store.initialHeadFields(),
  };
  const snapshot = await store.withDurabilityBatch(async () => {
    store.beginCommit(empty);
    const identity = await store.put(Buffer.from("record"));
    await store.publishReachable([identity]);
    return { ...empty, generation: 1, ...store.publicationHeadFields() };
  });
  const read = store.segments.read.bind(store.segments);
  let reads = 0;
  store.segments.read = async (...args) => {
    reads += 1;
    return read(...args);
  };
  await store.withSnapshot(snapshot, async () => {
    const pages = await Promise.all([
      store.locations.readPage(snapshot.locationRoot, ""),
      store.locations.readPage(snapshot.locationRoot, ""),
    ]);
    assert.equal(reads, 1);
    assert.equal(pages[0], pages[1]);
    assert.equal(Object.isFrozen(pages[0]), true);
    const scope = store.reads.getStore();
    assert.equal(scope.records.has(snapshot.locationRoot), false);
    assert.equal(scope.records.has(`index:physical::${snapshot.locationRoot}`), true);
    assert.equal(scope.records.size, 1);
  });
  await store.withSnapshot(snapshot, () => store.locations.readPage(snapshot.locationRoot, ""));
  assert.equal(reads, 2, "a new read scope must verify physical bytes again");
});

test("physical reads preserve index cache capacity and return independent verified buffers", async (t) => {
  const store = await fixture(t);
  const batch = store.segments.createBatch();
  const reference = batch.stage(Buffer.from("record"));
  await batch.publish([reference]);
  const read = store.segments.read.bind(store.segments);
  let reads = 0;
  store.segments.read = async (...args) => {
    reads += 1;
    return read(...args);
  };
  await store.withReadScope(async () => {
    const scope = store.reads.getStore();
    const page = { size: IMMUTABLE_TRANSACTION_READ_CACHE.bytes / 2 };
    store.rememberRead(scope, "index", page);
    const [first, second] = await Promise.all([
      store.readPhysical(reference),
      store.readPhysical(reference),
    ]);
    assert.equal(reads, 1);
    assert.equal(scope.records.has(reference), false);
    first.fill(0);
    assert.equal(second.toString(), "record");
    assert.equal((await store.readPhysical(reference)).toString(), "record");
    assert.equal(reads, 2);
    assert.equal(scope.records.size, 1);
    assert.equal(scope.records.get("index"), page);
  });
});

test("located physical reads detect changed bytes within the same scope", async (t) => {
  const store = await fixture(t);
  const batch = store.segments.createBatch();
  const reference = batch.stage(Buffer.from("record"));
  await batch.publish([reference]);
  const record = decodeImmutableRecordReference(reference);
  await store.withReadScope(async () => {
    await store.readPhysical(reference);
    const handle = await open(store.segments.segmentPath(record.segmentId), "r+");
    try {
      await handle.write(Buffer.from("broken"), 0, record.length, record.offset);
    } finally {
      await handle.close();
    }
    await assert.rejects(store.readPhysical(reference), {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    });
    await store.withPhysicalRepairOverlay(
      { replacements: new Map([[record.digest, Buffer.from("record")]]), used: new Set() },
      async () => assert.equal((await store.readPhysical(reference)).toString(), "record"),
    );
    await assert.rejects(store.readPhysical(reference), {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    });
  });
});

test("failed physical reads reject all waiters, release in-flight bytes, and permit retry", async (t) => {
  const store = await fixture(t);
  const batch = store.segments.createBatch();
  const reference = batch.stage(Buffer.from("record"));
  await batch.publish([reference]);
  const read = store.segments.read.bind(store.segments);
  const failure = new Error("read failed");
  let rejectRead;
  let reads = 0;
  store.segments.read = () => {
    reads += 1;
    return new Promise((_resolve, reject) => {
      rejectRead = reject;
    });
  };
  let scope;
  await store.withReadScope(async () => {
    scope = store.reads.getStore();
    const results = Promise.allSettled([
      store.readPhysical(reference),
      store.readPhysical(reference),
    ]);
    await Promise.resolve();
    assert.equal(reads, 1);
    assert.equal(scope.records.has(reference), true);
    rejectRead(failure);
    for (const result of await results) {
      assert.equal(result.status, "rejected");
      assert.equal(result.reason, failure);
    }
    assert.equal(scope.records.size, 0);
    store.segments.read = read;
    assert.equal((await store.readPhysical(reference)).toString(), "record");
  });
  assert.equal(scope.records.size, 0);
  assert.equal(scope.active, false);
});

test("verified business pages revalidate evicted snapshot membership while reusing decoded pages", async (t) => {
  const store = await fixture(t);
  const empty = {
    format: IMMUTABLE_LOCATED_SESSION_FORMAT,
    generation: 0,
    ...store.initialHeadFields(),
  };
  let reference;
  const snapshot = await store.withDurabilityBatch(async () => {
    store.beginCommit(empty);
    const value = await store.putValue("value");
    reference = await store.putIndexPage({ kind: "index-leaf", entries: [["key", value]] }, "");
    await store.publishReachable([reference]);
    return { ...empty, generation: 1, ...store.publicationHeadFields() };
  });
  const locate = store.locations.getMany.bind(store.locations);
  let queries = 0;
  t.mock.method(store.locations, "getMany", (...args) => {
    queries += 1;
    return locate(...args);
  });
  await store.withSnapshot(snapshot, async () => {
    const first = await store.readIndexPage(reference, "");
    assert.equal(queries, 1);
    const scope = store.reads.getStore();
    const locationKey = `location:${snapshot.locationRoot}:${reference}`;
    scope.bytes -= scope.records.get(locationKey).size;
    scope.records.delete(locationKey);
    assert.strictEqual(await store.readIndexPage(reference, ""), first);
    assert.equal(queries, 2);
    await assert.rejects(
      store.withSnapshot(empty, () => store.readIndexPage(reference, "")),
      {
        code: "SESSION_IMMUTABLE_STORAGE_INVALID",
      },
    );
    await assert.rejects(store.readIndexPage(reference, "z"), {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    });
    assert.strictEqual(await store.readIndexPage(reference, ""), first);
  });
});
