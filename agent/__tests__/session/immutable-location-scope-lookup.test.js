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
import { ImmutableLocatedRecordStore } from "../../src/session/session-artifact-session/immutable-located-record-store.js";
import { IMMUTABLE_LOCATED_SESSION_FORMAT } from "@noobot/session-protocol/immutable-record-location";
import { IMMUTABLE_TRANSACTION_READ_CACHE } from "@noobot/session-protocol/immutable-storage-graph";

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "located-lookup-scope-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new ImmutableLocatedRecordStore(directory);
  const empty = {
    format: IMMUTABLE_LOCATED_SESSION_FORMAT,
    generation: 0,
    ...store.initialHeadFields(),
  };
  let identity;
  const snapshot = await store.withDurabilityBatch(async () => {
    store.beginCommit(empty);
    identity = await store.put(Buffer.from("verified record"));
    await store.publishReachable([identity]);
    return { ...empty, generation: 1, ...store.publicationHeadFields() };
  });
  return { store, identity, snapshot, empty };
}

test("single and batch reads share a bounded snapshot-specific location lookup", async (t) => {
  const { store, identity, snapshot, empty } = await fixture(t);
  let lookups = 0;
  const original = store.locations.getMany.bind(store.locations);
  store.locations.getMany = async (...args) => {
    lookups += 1;
    return original(...args);
  };
  await store.withSnapshot(snapshot, async () => {
    assert.equal((await store.read(identity)).toString(), "verified record");
    assert.equal((await store.readMany([identity])).get(identity).toString(), "verified record");
    assert.equal(lookups, 1);

    await assert.rejects(
      store.withSnapshot(empty, () => store.read(identity)),
      /location is missing/,
    );
    assert.equal(lookups, 2);
    assert.equal((await store.read(identity)).toString(), "verified record");
    assert.equal(lookups, 2);
    const scope = store.reads.getStore();
    assert.ok(scope.bytes <= IMMUTABLE_TRANSACTION_READ_CACHE.bytes);
    assert.ok(scope.records.size <= IMMUTABLE_TRANSACTION_READ_CACHE.records);
  });
  assert.equal(store.reads.getStore(), undefined);
  await store.withSnapshot(snapshot, () => store.read(identity));
  assert.equal(lookups, 3);
});

test("locator reuse evicts within the shared budget and resolves evicted entries from storage", async (t) => {
  const { store, snapshot } = await fixture(t);
  const identities = [];
  const next = await store.withDurabilityBatch(async () => {
    store.beginCommit(snapshot);
    for (let i = 0; i <= IMMUTABLE_TRANSACTION_READ_CACHE.records; i += 1)
      identities.push(await store.put(Buffer.from(`bounded-record-${i}`)));
    await store.publishReachable(identities);
    return { ...snapshot, generation: 2, ...store.publicationHeadFields() };
  });
  await store.withSnapshot(next, async () => {
    const locations = await store.locateRecords(next.locationRoot, identities);
    const scope = store.reads.getStore();
    assert.equal(scope.records.has(`location:${next.locationRoot}:${identities[0]}`), false);
    assert.ok(scope.records.size <= IMMUTABLE_TRANSACTION_READ_CACHE.records);
    assert.ok(scope.bytes <= IMMUTABLE_TRANSACTION_READ_CACHE.bytes);
    let lookups = 0;
    const original = store.locations.getMany.bind(store.locations);
    store.locations.getMany = async (...args) => {
      lookups += 1;
      return original(...args);
    };
    const resolved = await store.locateRecords(next.locationRoot, [identities[0]]);
    assert.equal(resolved.get(identities[0]), locations.get(identities[0]));
    assert.equal(lookups, 1);
    assert.ok(scope.records.size <= IMMUTABLE_TRANSACTION_READ_CACHE.records);
    assert.ok(scope.bytes <= IMMUTABLE_TRANSACTION_READ_CACHE.bytes);
  });
});

test("failed locator lookup propagates and cannot populate a successful cached location", async (t) => {
  const { store, identity, snapshot } = await fixture(t);
  const failure = new Error("injected locator read failure");
  const original = store.locations.getMany.bind(store.locations);
  let fail = true;
  let lookups = 0;
  store.locations.getMany = async (...args) => {
    lookups += 1;
    if (fail) throw failure;
    return original(...args);
  };
  await store.withSnapshot(snapshot, async () => {
    await assert.rejects(store.read(identity), (error) => error === failure);
    fail = false;
    assert.equal((await store.read(identity)).toString(), "verified record");
    assert.equal(lookups, 2);
  });
});
