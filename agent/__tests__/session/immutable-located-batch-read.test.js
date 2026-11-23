/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { setImmediate } from "node:timers/promises";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import path from "node:path";
import { ImmutableLocatedRecordStore } from "../../src/session/session-artifact-session/immutable-located-record-store.js";
import { ImmutableRadixIndex } from "../../src/session/session-artifact-session/immutable-radix-index.js";
import { IMMUTABLE_LOCATED_SESSION_FORMAT } from "@noobot/session-protocol/immutable-record-location";
import { decodeImmutableRecordReference } from "@noobot/session-protocol/immutable-segment";
import { IMMUTABLE_VALUE_READ_BATCH_RECORDS } from "@noobot/session-protocol/immutable-storage-graph";
import { observeSessionStorageWork } from "../../src/session/session-storage-observation.js";

async function fixture(t, values) {
  const directory = await mkdtemp(path.join(tmpdir(), "located-batch-read-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const writer = new ImmutableLocatedRecordStore(directory);
  const empty = {
    format: IMMUTABLE_LOCATED_SESSION_FORMAT,
    generation: 0,
    ...writer.initialHeadFields(),
  };
  let roots;
  const snapshot = await writer.withDurabilityBatch(async () => {
    writer.beginCommit(empty);
    roots = [];
    for (const value of values) roots.push(await writer.putValue(value));
    await writer.publishReachable(roots);
    return { ...empty, generation: 1, ...writer.publicationHeadFields() };
  });
  return { directory, roots, snapshot, reader: new ImmutableLocatedRecordStore(directory) };
}

test("batch value reads group locator paths, preserve order and decode duplicate roots independently", async (t) => {
  const values = Array.from({ length: 200 }, (_, i) => ({ i, nested: { value: `record-${i}` } }));
  const { directory, roots, snapshot, reader } = await fixture(t, values);
  let batchVisits = 0;
  const original = reader.locations.objects.readIndexPage.bind(reader.locations.objects);
  reader.locations.objects.readIndexPage = async (...args) => {
    batchVisits += 1;
    return original(...args);
  };
  const result = await reader.withSnapshot(snapshot, () => reader.readValues([...roots, roots[0]]));
  assert.deepEqual(result, [...values, values[0]]);
  result[0].nested.value = "caller mutation";
  assert.equal(result.at(-1).nested.value, "record-0");
  const cold = new ImmutableLocatedRecordStore(directory);
  let singleVisits = 0;
  const readPage = cold.locations.objects.readIndexPage.bind(cold.locations.objects);
  cold.locations.objects.readIndexPage = async (...args) => {
    singleVisits += 1;
    return readPage(...args);
  };
  await cold.withSnapshot(snapshot, async () => {
    for (const root of roots) await cold.readValue(root);
  });
  assert.ok(batchVisits < singleVisits, JSON.stringify({ batchVisits, singleVisits }));
});

test("root prefetch has a protocol bound and an empty batch performs no lookup", async (t) => {
  const values = Array.from({ length: IMMUTABLE_VALUE_READ_BATCH_RECORDS * 2 + 1 }, (_, i) => i);
  const { roots, snapshot, reader } = await fixture(t, values);
  const counts = [];
  const readMany = reader.readMany.bind(reader);
  reader.readMany = async (selected) => {
    counts.push(selected.length);
    return readMany(selected);
  };
  assert.deepEqual(await reader.readValues([]), []);
  assert.deepEqual(counts, []);
  assert.deepEqual(await reader.withSnapshot(snapshot, () => reader.readValues(roots)), values);
  assert.deepEqual(counts, [
    IMMUTABLE_VALUE_READ_BATCH_RECORDS,
    IMMUTABLE_VALUE_READ_BATCH_RECORDS,
    1,
  ]);
});

test("batch reads mix staged and committed records without leaking abandoned records to old snapshots", async (t) => {
  const { roots, snapshot, reader } = await fixture(t, [{ committed: true }]);
  let staged;
  await reader.withDurabilityBatch(async () => {
    reader.beginCommit(snapshot);
    staged = await reader.putValue({ staged: true });
    assert.deepEqual(await reader.readValues([staged, roots[0], staged]), [
      { staged: true },
      { committed: true },
      { staged: true },
    ]);
  });
  await assert.rejects(
    reader.withSnapshot(snapshot, () => reader.readValues([staged])),
    /location is missing/,
  );
  assert.deepEqual(await reader.withSnapshot(snapshot, () => reader.readValues(roots)), [
    { committed: true },
  ]);
});

test("batch root decoding preserves composite content and byte-tree validation", async (t) => {
  const values = [{ text: "large".repeat(20000) }, null, [1, 2, 3]];
  const { roots, snapshot, reader } = await fixture(t, values);
  assert.deepEqual(await reader.withSnapshot(snapshot, () => reader.readValues(roots)), values);
  let composite;
  const next = await reader.withDurabilityBatch(async () => {
    reader.beginCommit(snapshot);
    composite = await reader.putValue(
      { message: { content: "part".repeat(20000) } },
      { contentPaths: [["message", "content"]] },
    );
    await reader.publishReachable([composite]);
    return { ...snapshot, generation: 2, ...reader.publicationHeadFields() };
  });
  assert.deepEqual(await reader.withSnapshot(next, () => reader.readValues([composite])), [
    { message: { content: "part".repeat(20000) } },
  ]);
});

test("physical batch reads overlap within the protocol budget and preserve caller order", async (t) => {
  const limit = QUANTITY_THRESHOLDS.immutableStorage.recordIoConcurrency;
  const values = Array.from({ length: limit * 2 + 1 }, (_, i) => ({ i }));
  const { roots, snapshot, reader } = await fixture(t, values);
  let active = 0;
  let maximum = 0;
  const original = reader.readPhysical.bind(reader);
  reader.readPhysical = async (...args) => {
    active += 1;
    maximum = Math.max(maximum, active);
    try {
      await setImmediate();
      return await original(...args);
    } finally {
      active -= 1;
    }
  };
  assert.deepEqual(await reader.withSnapshot(snapshot, () => reader.readValues(roots)), values);
  assert.ok(maximum > 1);
  assert.ok(maximum <= limit);
  assert.equal(active, 0);
});

test("a failed physical batch drains every started read before releasing its scope", async (t) => {
  const limit = QUANTITY_THRESHOLDS.immutableStorage.recordIoConcurrency;
  const { roots, snapshot, reader } = await fixture(
    t,
    Array.from({ length: limit + 2 }, (_, i) => i),
  );
  const locations = await reader.locations.getMany(snapshot.locationRoot, roots);
  const businessLocations = new Set(locations.values());
  const failure = new Error("injected record read failure");
  const blocked = Promise.withResolvers();
  const entered = Promise.withResolvers();
  let active = 0;
  let started = 0;
  let settled = false;
  const original = reader.readPhysical.bind(reader);
  reader.readPhysical = async (reference) => {
    if (!businessLocations.has(reference)) return original(reference);
    const index = started++;
    active += 1;
    if (started === limit) entered.resolve();
    try {
      if (index === 0) throw failure;
      await blocked.promise;
      assert.equal(reader.reads.getStore().active, true);
      return await original(reference);
    } finally {
      active -= 1;
    }
  };
  const result = reader.withSnapshot(snapshot, () => reader.readValues(roots));
  const rejected = assert.rejects(result, (error) => error === failure);
  result.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await entered.promise;
  await setImmediate();
  assert.equal(settled, false);
  blocked.resolve();
  await rejected;
  assert.equal(active, 0);
  assert.equal(started, limit);
  assert.equal(reader.reads.getStore(), undefined);
});

test("batch reads report corruption and release their read scope before retry", async (t) => {
  const { roots, snapshot, reader } = await fixture(t, [{ text: "verified" }]);
  const location = decodeImmutableRecordReference(
    await reader.locations.get(snapshot.locationRoot, roots[0]),
  );
  const handle = await open(reader.segments.segmentPath(location.segmentId), "r+");
  try {
    await handle.write(Buffer.from([0]), 0, 1, location.offset);
  } finally {
    await handle.close();
  }
  await assert.rejects(
    reader.withSnapshot(snapshot, () => reader.readValues(roots)),
    { code: "SESSION_IMMUTABLE_STORAGE_INVALID" },
  );
  assert.equal(reader.reads.getStore(), undefined);
  await assert.rejects(
    reader.withSnapshot(snapshot, () => reader.readValues(roots)),
    { code: "SESSION_IMMUTABLE_STORAGE_INVALID" },
  );
});

async function noncontiguousReuseFixture(t, count) {
  const stored = Array.from({ length: count * 2 }, (_, index) => ({ reused: index }));
  const { roots: storedRoots, snapshot, reader } = await fixture(t, stored);
  const locations = await reader.locations.getMany(snapshot.locationRoot, storedRoots);
  const ordered = storedRoots.toSorted(
    (left, right) =>
      decodeImmutableRecordReference(locations.get(left)).offset -
      decodeImmutableRecordReference(locations.get(right)).offset,
  );
  const roots = ordered.filter((_, index) => index % 2 === 0);
  const valuesByRoot = new Map(storedRoots.map((root, index) => [root, stored[index]]));
  return { roots, values: roots.map((root) => valuesByRoot.get(root)), snapshot, reader };
}

test("publication verifies reused records concurrently without allocating replacement copies", async (t) => {
  const limit = QUANTITY_THRESHOLDS.immutableStorage.recordIoConcurrency;
  const { roots, values, snapshot, reader } = await noncontiguousReuseFixture(t, limit * 2 + 1);
  const identities = new Set(roots);
  const read = reader.segments.readRecords.bind(reader.segments);
  let active = 0;
  let maximum = 0;
  let verified = 0;
  reader.segments.readRecords = async (records) => {
    if (!identities.has(records[0].digest)) return read(records);
    assert.equal(records.length, 1);
    active += 1;
    maximum = Math.max(maximum, active);
    verified += 1;
    try {
      await setImmediate();
      return await read(records);
    } finally {
      active -= 1;
    }
  };
  await reader.withDurabilityBatch(async () => {
    reader.beginCommit(snapshot);
    const reused = [];
    for (const value of values) reused.push(await reader.putValue(value));
    assert.deepEqual(reused, roots);
    await reader.publishReachable(reused);
    assert.deepEqual(reader.publicationHeadFields(), {
      locationRoot: snapshot.locationRoot,
      segmentTail: snapshot.segmentTail,
    });
  });
  assert.equal(verified, values.length);
  assert.ok(maximum > 1 && maximum <= limit);
  assert.equal(active, 0);
});

test("publication failure drains reused-record verification and leaves the previous snapshot intact", async (t) => {
  const limit = QUANTITY_THRESHOLDS.immutableStorage.recordIoConcurrency;
  const { roots, values, snapshot, reader } = await noncontiguousReuseFixture(t, limit + 2);
  const identities = new Set(roots);
  const read = reader.segments.readRecords.bind(reader.segments);
  const release = Promise.withResolvers();
  const entered = Promise.withResolvers();
  const failure = new Error("reused record verification failed");
  let started = 0;
  let active = 0;
  let settled = false;
  let publications = 0;
  const append = reader.segments.appendSegment.bind(reader.segments);
  reader.segments.appendSegment = (...args) => {
    publications += 1;
    return append(...args);
  };
  reader.segments.readRecords = async (records) => {
    if (!identities.has(records[0].digest)) return read(records);
    assert.equal(records.length, 1);
    const ordinal = started++;
    active += 1;
    if (started === limit) entered.resolve();
    try {
      if (ordinal === 0) throw failure;
      await release.promise;
      assert.equal(reader.reads.getStore().active, true);
      return await read(records);
    } finally {
      active -= 1;
    }
  };
  const operation = reader.withDurabilityBatch(async () => {
    reader.beginCommit(snapshot);
    const reused = [];
    for (const value of values) reused.push(await reader.putValue(value));
    const added = await reader.putValue({ added: true });
    await reader.publishReachable([...reused, added]);
  });
  const observed = operation.then(
    () => {
      settled = true;
      assert.fail("publication must reject");
    },
    (error) => {
      settled = true;
      return error;
    },
  );
  try {
    await Promise.race([
      entered.promise,
      observed.then(() => assert.fail("verification ended before admitting the first batch")),
    ]);
    await setImmediate();
    assert.equal(settled, false);
  } finally {
    release.resolve();
  }
  assert.equal(await observed, failure);
  assert.equal(active, 0);
  assert.equal(started, limit);
  assert.equal(publications, 0);
  reader.segments.readRecords = read;
  assert.deepEqual(await reader.withSnapshot(snapshot, () => reader.readValues(roots)), values);
});

test("index updates group committed page locations and preserve the pinned index", async (t) => {
  const values = Array.from({ length: 200 }, (_, i) => ({ i }));
  const { roots, snapshot, reader } = await fixture(t, values);
  const index = new ImmutableRadixIndex(reader, 256);
  const entries = roots.map((reference, i) => [`key-${i}`, reference]);
  let root;
  let indexed;
  await reader.withDurabilityBatch(async () => {
    reader.beginCommit(snapshot);
    root = await index.setMany(null, entries);
    await reader.publishReachable([root]);
    indexed = { ...snapshot, generation: 2, ...reader.publicationHeadFields() };
  });
  const locate = reader.locations.getMany.bind(reader.locations);
  let queries = 0;
  const resolved = new Set();
  reader.locations.getMany = (locationRoot, references) => {
    queries += 1;
    for (const reference of references) {
      assert.ok(!resolved.has(reference), `Repeated location resolution for ${reference}`);
      resolved.add(reference);
    }
    return locate(locationRoot, references);
  };
  const changes = entries.map(([key], i) => [key, roots[(i + 1) % roots.length]]);
  let updated;
  let next;
  await reader.withDurabilityBatch(async () => {
    reader.beginCommit(indexed);
    const measured = await observeSessionStorageWork(() => index.setMany(root, changes));
    updated = measured.result;
    assert.ok(queries > 0 && queries < resolved.size, JSON.stringify(measured.work));
    reader.locations.getMany = locate;
    await reader.publishReachable([updated]);
    next = { ...indexed, generation: 3, ...reader.publicationHeadFields() };
  });
  const keys = entries.map(([key]) => key);
  assert.deepEqual(
    await reader.withSnapshot(next, () => index.getMany(updated, keys)),
    new Map(changes),
  );
  assert.deepEqual(
    await reader.withSnapshot(indexed, () => index.getMany(root, keys)),
    new Map(entries),
  );
});
