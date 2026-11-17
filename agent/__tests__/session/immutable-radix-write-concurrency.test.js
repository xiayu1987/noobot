/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { contentDigest } from "../../src/session/session-artifact-session/immutable-storage-io.js";
import {
  ImmutableRadixIndex,
  readImmutableIndexPages,
  validateImmutableIndexPage,
} from "../../src/session/session-artifact-session/immutable-radix-index.js";

async function fixture() {
  const pages = new Map();
  const requireReference = (reference) => assert.match(reference, /^[a-f0-9]{64}$/);
  const objects = {
    requireReference,
    readIndexPages(nodes) {
      return readImmutableIndexPages(this, nodes);
    },
    async putIndexPage(page, prefix) {
      validateImmutableIndexPage(page, prefix, requireReference);
      const reference = contentDigest(JSON.stringify(page));
      pages.set(reference, structuredClone(page));
      return reference;
    },
    async readIndexPage(reference, prefix) {
      return validateImmutableIndexPage(
        structuredClone(pages.get(reference)),
        prefix,
        requireReference,
      );
    },
  };
  const index = new ImmutableRadixIndex(objects, 256);
  const entries = Array.from({ length: 192 }, (_, i) => [`key-${i}`, contentDigest(`value-${i}`)]);
  const root = await index.setMany(null, entries);
  return { index, objects, entries, root };
}

test("batch index updates read shared paths once with a single concurrency budget and preserve old roots", async () => {
  const { index, objects, entries, root } = await fixture();
  const read = objects.readIndexPage;
  const visited = [];
  let active = 0;
  let maximum = 0;
  objects.readIndexPage = async (reference, prefix) => {
    active += 1;
    maximum = Math.max(maximum, active);
    visited.push(reference);
    try {
      await setImmediate();
      return await read(reference, prefix);
    } finally {
      active -= 1;
    }
  };
  const changes = entries.map(([key], i) => [key, i % 3 ? contentDigest(`changed-${i}`) : null]);
  changes.push(["new-key", contentDigest("new-value")]);
  const changed = await index.setMany(root, changes);
  assert.equal(active, 0);
  assert.ok(maximum > 1);
  assert.ok(maximum <= QUANTITY_THRESHOLDS.immutableStorage.recordIoConcurrency);
  assert.equal(new Set(visited).size, visited.length);
  assert.deepEqual(
    await index.getMany(
      changed,
      changes.map(([key]) => key),
    ),
    new Map(changes),
  );
  assert.deepEqual(
    await index.getMany(
      root,
      entries.map(([key]) => key),
    ),
    new Map(entries),
  );
});

test("sibling index writes share the storage concurrency budget and preserve old roots", async () => {
  const { index, objects, entries, root } = await fixture();
  const put = objects.putIndexPage;
  let active = 0;
  let maximum = 0;
  objects.putIndexPage = async (...args) => {
    active += 1;
    maximum = Math.max(maximum, active);
    try {
      await setImmediate();
      return await put(...args);
    } finally {
      active -= 1;
    }
  };
  const changes = entries.map(([key]) => [key, contentDigest(`changed-${key}`)]);
  const changed = await index.setMany(root, changes);
  assert.equal(active, 0);
  assert.ok(maximum > 1);
  assert.ok(maximum <= QUANTITY_THRESHOLDS.immutableStorage.recordIoConcurrency);
  const keys = entries.map(([key]) => key);
  assert.deepEqual(await index.getMany(changed, keys), new Map(changes));
  assert.deepEqual(await index.getMany(root, keys), new Map(entries));
});

test("failed sibling writes drain admitted work before rejecting and leave the old root intact", async () => {
  const { index, objects, entries, root } = await fixture();
  const put = objects.putIndexPage;
  const failure = new Error("index page write failed");
  const release = Promise.withResolvers();
  const failed = Promise.withResolvers();
  let active = 0;
  let started = 0;
  let settled = false;
  objects.putIndexPage = async (...args) => {
    const ordinal = started++;
    active += 1;
    try {
      if (ordinal === 0) {
        failed.resolve();
        throw failure;
      }
      await release.promise;
      return await put(...args);
    } finally {
      active -= 1;
    }
  };
  const observed = index
    .setMany(
      root,
      entries.map(([key]) => [key, contentDigest(`changed-${key}`)]),
    )
    .then(
      () => assert.fail("update must fail"),
      (error) => {
        settled = true;
        return error;
      },
    );
  await failed.promise;
  await setImmediate();
  const admitted = started;
  assert.ok(admitted > 1);
  assert.ok(admitted <= QUANTITY_THRESHOLDS.immutableStorage.recordIoConcurrency);
  assert.equal(settled, false);
  release.resolve();
  assert.equal(await observed, failure);
  assert.equal(active, 0);
  assert.equal(started, admitted);
  assert.deepEqual(
    await index.getMany(
      root,
      entries.map(([key]) => key),
    ),
    new Map(entries),
  );
});

test("no-op and empty index updates stage no replacement pages", async () => {
  const { index, objects, entries, root } = await fixture();
  let writes = 0;
  let reads = 0;
  const read = objects.readIndexPage;
  objects.putIndexPage = async () => {
    writes += 1;
    assert.fail("no-op must not stage pages");
  };
  objects.readIndexPage = (...args) => {
    reads += 1;
    return read(...args);
  };
  assert.equal(await index.setMany(root, []), root);
  assert.equal(reads, 0);
  assert.equal(await index.setMany(root, entries), root);
  assert.equal(writes, 0);
  assert.equal(
    await index.setMany(
      root,
      entries.map(([key]) => [key, null]),
    ),
    null,
  );
});

test("failed batch update drains admitted reads and writes no intermediate pages", async () => {
  const { index, objects, entries, root } = await fixture();
  const read = objects.readIndexPage;
  const failure = new Error("index update read failed");
  const release = Promise.withResolvers();
  const failed = Promise.withResolvers();
  let active = 0;
  let started = 0;
  let writes = 0;
  let settled = false;
  objects.putIndexPage = async () => {
    writes += 1;
    assert.fail("failed reads must not stage pages");
  };
  objects.readIndexPage = async (reference, prefix) => {
    if (reference === root) return read(reference, prefix);
    const ordinal = started++;
    active += 1;
    try {
      if (ordinal === 0) {
        failed.resolve();
        throw failure;
      }
      await release.promise;
      return await read(reference, prefix);
    } finally {
      active -= 1;
    }
  };
  const observed = index
    .setMany(
      root,
      entries.map(([key]) => [key, contentDigest(`new-${key}`)]),
    )
    .then(
      () => assert.fail("update must fail"),
      (error) => {
        settled = true;
        return error;
      },
    );
  await failed.promise;
  await setImmediate();
  const admitted = started;
  assert.ok(admitted > 1);
  assert.ok(admitted <= QUANTITY_THRESHOLDS.immutableStorage.recordIoConcurrency);
  assert.equal(settled, false);
  release.resolve();
  assert.equal(await observed, failure);
  assert.equal(active, 0);
  assert.equal(started, admitted);
  assert.equal(writes, 0);
});
