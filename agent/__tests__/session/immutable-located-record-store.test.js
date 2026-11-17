/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, open, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableLocatedRecordStore } from "../../src/session/session-artifact-session/immutable-located-record-store.js";
import { ImmutableRadixIndex } from "../../src/session/session-artifact-session/immutable-radix-index.js";
import {
  IMMUTABLE_LOCATED_SESSION_FORMAT,
  requireImmutableRecordLocation,
} from "@noobot/session-protocol/immutable-record-location";
import {
  IMMUTABLE_SEGMENT,
  decodeImmutableRecordReference,
  encodeImmutableRecordReference,
} from "@noobot/session-protocol/immutable-segment";
import { observeSessionStorageWork } from "../../src/session/session-artifact-session/storage-transaction.js";
import { IMMUTABLE_TRANSACTION_READ_CACHE } from "@noobot/session-protocol/immutable-storage-graph";

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "located-records-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const records = new ImmutableLocatedRecordStore(directory);
  const empty = {
    format: IMMUTABLE_LOCATED_SESSION_FORMAT,
    generation: 0,
    ...records.initialHeadFields(),
  };
  return { directory, records, empty };
}

async function commit(records, snapshot, prepare) {
  return records.withDurabilityBatch(async () => {
    records.beginCommit(snapshot);
    const roots = await prepare();
    await records.publishReachable(roots);
    return { ...snapshot, generation: snapshot.generation + 1, ...records.publicationHeadFields() };
  });
}

test("only final records reserve bytes; all segment ranges are tightly packed", async (t) => {
  const { records, empty, directory } = await fixture(t);
  let root;
  let abandoned;
  const snapshot = await commit(records, empty, async () => {
    abandoned = await records.put(Buffer.alloc(20000, 9));
    await records.putValue({ discarded: true });
    root = await records.putValue({ content: "kept" });
    return [root];
  });
  const cold = new ImmutableLocatedRecordStore(directory);
  await cold.withSnapshot(snapshot, async () => {
    assert.deepEqual(await cold.readValue(root), { content: "kept" });
    await assert.rejects(cold.read(abandoned), /location is missing/);
    const ranges = [];
    for await (const [identity, location] of cold.locations.entries(snapshot.locationRoot)) {
      requireImmutableRecordLocation(identity, location);
      ranges.push(decodeImmutableRecordReference(location));
    }

    ranges.push(decodeImmutableRecordReference(snapshot.locationRoot));
    ranges.sort((a, b) => a.offset - b.offset);
    let end = IMMUTABLE_SEGMENT.magic.length;
    for (const range of ranges) {
      assert.equal(range.offset, end, "no address space belongs to abandoned records");
      end += range.length;
    }
    assert.equal(end, snapshot.segmentTail.end);
    assert.equal((await stat(cold.segments.segmentPath(snapshot.segmentTail.segmentId))).size, end);
  });
  assert.equal((await readdir(path.join(directory, "segments"))).length, 1);
  await assert.rejects(cold.read(root), /pinned snapshot/);
});

test("business radix references stay stable across transactions and cold snapshots", async (t) => {
  const { records, empty, directory } = await fixture(t);
  const index = new ImmutableRadixIndex(records);
  let original;
  const first = await commit(records, empty, async () => {
    const entries = [];
    for (let i = 0; i < 300; i += 1) entries.push([`key-${i}`, await records.putValue({ i })]);
    original = await index.setMany(null, entries);
    return [original];
  });
  let updated;
  const second = await commit(records, first, async () => {
    updated = await index.set(original, "key-100", await records.putValue({ i: "changed" }));
    return [updated];
  });
  assert.equal(second.segmentTail.segmentId, first.segmentTail.segmentId);
  const cold = new ImmutableLocatedRecordStore(directory);
  const coldIndex = new ImmutableRadixIndex(cold);
  await cold.withSnapshot(first, async () => {
    assert.deepEqual(await cold.readValue(await coldIndex.get(original, "key-100")), { i: 100 });
    await assert.rejects(cold.readPage(updated), /location is missing/);
  });
  await cold.withSnapshot(second, async () => {
    assert.deepEqual(await cold.readValue(await coldIndex.get(updated, "key-100")), {
      i: "changed",
    });
    assert.deepEqual(await cold.readValue(await coldIndex.get(updated, "key-299")), { i: 299 });
  });
  assert.equal((await readdir(path.join(directory, "segments"))).length, 1);
});

test("relocation changes only location paths; old and new snapshots remain readable", async (t) => {
  const { records, empty, directory } = await fixture(t);
  let root;
  const first = await commit(records, empty, async () => {
    root = await records.putValue({ text: "immutable" });
    return [root];
  });
  const second = await commit(records, first, async () => {
    assert.equal(
      await records.relocate({
        identity: root,
        sourceLocation: await records.locations.get(first.locationRoot, root),
      }),
      root,
    );
    return [root];
  });
  assert.notEqual(first.locationRoot, second.locationRoot);
  const cold = new ImmutableLocatedRecordStore(directory);
  const locations = [];
  for (const snapshot of [first, second])
    await cold.withSnapshot(snapshot, async () => {
      locations.push(await cold.locations.get(snapshot.locationRoot, root));
      assert.deepEqual(await cold.readValue(root), { text: "immutable" });
    });
  assert.notEqual(locations[0], locations[1]);
  assert.equal(decodeImmutableRecordReference(locations[0]).digest, root);
  assert.equal(decodeImmutableRecordReference(locations[1]).digest, root);
});

test("relocating a committed child publishes its location without rewriting the parent", async (t) => {
  const { records, empty, directory } = await fixture(t);
  const index = new ImmutableRadixIndex(records);
  let root;
  let child;
  const first = await commit(records, empty, async () => {
    child = await records.putValue({ text: "retained child" });
    root = await index.set(null, "child", child);
    return [root];
  });
  let abandoned;
  const second = await commit(records, first, async () => {
    await records.relocate({
      identity: child,
      sourceLocation: await records.locations.get(first.locationRoot, child),
    });
    abandoned = await records.putValue({ text: "unreachable" });
    return [root];
  });
  const cold = new ImmutableLocatedRecordStore(directory);
  const oldChild = await cold.locations.get(first.locationRoot, child);
  const newChild = await cold.locations.get(second.locationRoot, child);
  assert.notEqual(newChild, oldChild, "explicit relocation must survive transaction graph pruning");
  assert.equal(
    await cold.locations.get(first.locationRoot, root),
    await cold.locations.get(second.locationRoot, root),
    "the unchanged parent retains its physical location",
  );
  for (const snapshot of [first, second]) {
    await cold.withSnapshot(snapshot, async () => {
      const coldIndex = new ImmutableRadixIndex(cold);
      assert.equal(await coldIndex.get(root, "child"), child);
      assert.deepEqual(await cold.readValue(child), { text: "retained child" });
      await assert.rejects(cold.read(abandoned), /location is missing/);
    });
  }
});

test("relocation rejects staged records without a committed source location", async (t) => {
  const { records, empty } = await fixture(t);
  await records.withDurabilityBatch(async () => {
    records.beginCommit(empty);
    const staged = await records.putValue({ text: "not committed" });
    const source = {
      identity: staged,
      sourceLocation: encodeImmutableRecordReference({
        segmentId: "0".repeat(32),
        offset: IMMUTABLE_SEGMENT.magic.length,
        length: 0,
        digest: staged,
      }),
    };
    await assert.rejects(records.relocate(source), {
      code: "SESSION_RELOCATION_SOURCE_CHANGED",
      conflict: { ...source, currentLocation: null },
    });
    assert.equal(records.batch().relocations.size, 0);
  });
});

test("identical records reuse committed locations without growing the segment", async (t) => {
  const { records, empty } = await fixture(t);
  let root;
  const first = await commit(records, empty, async () => {
    root = await records.putValue({ text: "same" });
    return [root];
  });
  const { result: second, work } = await observeSessionStorageWork(() =>
    commit(records, first, async () => {
      assert.equal(await records.putValue({ text: "same" }), root);
      return [root];
    }),
  );
  assert.equal(first.locationRoot, second.locationRoot);
  assert.deepEqual(first.segmentTail, second.segmentTail);
  assert.equal(work.immutableSegmentSyncs ?? 0, 0);
  assert.equal(work.immutableWriteBytes ?? 0, 0);
});

test("rejected transactions publish nothing and completed scopes reject leaked writes", async (t) => {
  const { records, empty, directory } = await fixture(t);
  const failure = new Error("abort before publication");
  let late;
  await assert.rejects(
    records.withDurabilityBatch(async () => {
      records.beginCommit(empty);
      await records.putValue({ rejected: true });
      late = () => records.putValue({ late: true });
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.deepEqual(await readdir(directory), []);
  await assert.rejects(late(), /required publication phase/);
});

test("same-size deltas avoid unrelated historical business values", async (t) => {
  const { records, empty, directory } = await fixture(t);
  const index = new ImmutableRadixIndex(records);
  let root;
  const first = await commit(records, empty, async () => {
    const entries = [];
    for (let i = 0; i < 500; i += 1)
      entries.push([`message-${i}`, await records.putValue({ i, text: "history".repeat(10) })]);
    root = await index.setMany(null, entries);
    return [root];
  });
  const cold = new ImmutableLocatedRecordStore(directory);
  const coldIndex = new ImmutableRadixIndex(cold);
  const { work } = await observeSessionStorageWork(() =>
    commit(cold, first, async () => {
      const updated = await coldIndex.set(
        root,
        "message-new",
        await cold.putValue({ text: "new" }),
      );
      return [updated];
    }),
  );
  assert.ok(work.immutableReadBytes < 100000, JSON.stringify(work));
  assert.ok(work.immutableWriteBytes < 30000, JSON.stringify(work));
  assert.equal(work.immutableSegmentSyncs, 1);
});

test("validated index pages remain bound to their path and locator snapshot", async (t) => {
  const { records, empty, directory } = await fixture(t);
  const index = new ImmutableRadixIndex(records);
  let root;
  const first = await commit(records, empty, async () => {
    root = await index.set(null, "key", await records.putValue({ text: "original" }));
    return [root];
  });
  const second = await commit(records, first, async () => {
    await records.relocate({
      identity: root,
      sourceLocation: await records.locations.get(first.locationRoot, root),
    });
    return [root];
  });
  const cold = new ImmutableLocatedRecordStore(directory);
  const oldLocation = decodeImmutableRecordReference(
    await cold.locations.get(first.locationRoot, root),
  );
  const handle = await open(cold.segments.segmentPath(oldLocation.segmentId), "r+");
  try {
    await handle.write(Buffer.from([0]), 0, 1, oldLocation.offset);
  } finally {
    await handle.close();
  }
  await cold.withReadScope(async () => {
    await cold.withSnapshot(second, async () => {
      const page = await cold.readIndexPage(root, "");
      assert.throws(() => {
        page.entries.length = 0;
      }, TypeError);
      assert.throws(() => {
        page.entries[0][1] = root;
      }, TypeError);
      const locateRecords = cold.locateRecords.bind(cold);
      let locationQueries = 0;
      cold.locateRecords = (...args) => {
        locationQueries += 1;
        return locateRecords(...args);
      };
      assert.equal(await cold.readIndexPage(root, ""), page);
      assert.equal((await cold.readIndexPage(root, "")).entries.length, 1);
      assert.equal(locationQueries, 0, "validated page hits must not repeat location queries");
      await assert.rejects(cold.readIndexPage(root, "not-a-hash-path"), {
        code: "SESSION_IMMUTABLE_STORAGE_INVALID",
      });
    });
    await assert.rejects(
      cold.withSnapshot(first, () => cold.readIndexPage(root, "")),
      { code: "SESSION_IMMUTABLE_STORAGE_INVALID" },
      "the new snapshot's validated page must not hide old-location corruption",
    );
  });
});

test("byte and validated-page entries share one bounded scope and are released on failure", async (t) => {
  const { records, empty } = await fixture(t);
  let root;
  const snapshot = await commit(records, empty, async () => {
    root = await records.putValue({ text: "bounded" });
    return [root];
  });
  let scope;
  const failure = new Error("scope failure");
  await assert.rejects(
    records.withSnapshot(snapshot, async () => {
      scope = records.reads.getStore();
      await records.readValue(root);
      for (let i = 0; i <= IMMUTABLE_TRANSACTION_READ_CACHE.records; i += 1)
        records.rememberRead(scope, `entry-${i}`, { bytes: Buffer.from([i % 256]), size: 1 });
      assert.ok(scope.records.size <= IMMUTABLE_TRANSACTION_READ_CACHE.records);
      assert.ok(scope.bytes <= IMMUTABLE_TRANSACTION_READ_CACHE.bytes);
      assert.equal(scope.records.has("entry-0"), false);
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.equal(scope.active, false);
  assert.equal(scope.records.size, 0);
  assert.equal(scope.bytes, 0);
});
