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
      pages.set(reference, page);
      return reference;
    },
    async readIndexPage(reference, prefix) {
      return validateImmutableIndexPage(pages.get(reference), prefix, requireReference);
    },
  };
  const index = new ImmutableRadixIndex(objects, 256);
  const entries = Array.from({ length: 192 }, (_, i) => [`key-${i}`, contentDigest(`value-${i}`)]);
  const root = await index.setMany(null, entries);
  return { index, objects, entries, root };
}

test("batch index lookup shares paths, preserves input order and bounds concurrency across all branches", async () => {
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
  const keys = [...entries.map(([key]) => key).reverse(), "missing", entries[0][0]];
  const expected = new Map(entries);
  const result = await index.getMany(root, keys);
  assert.deepEqual([...result.keys()], [...new Set(keys)]);
  for (const [key, value] of result) assert.equal(value, expected.get(key) ?? null);
  assert.equal(active, 0);
  assert.ok(maximum > 1);
  assert.ok(maximum <= QUANTITY_THRESHOLDS.immutableStorage.recordIoConcurrency);
  assert.equal(new Set(visited).size, visited.length, "a shared page is read only once");
  const beforeEmpty = visited.length;
  assert.deepEqual(await index.getMany(root, []), new Map());
  assert.equal(visited.length, beforeEmpty);
});

test("failed batch index lookup drains admitted reads before rejecting and stops admitting further branches", async () => {
  const { index, objects, entries, root } = await fixture();
  const read = objects.readIndexPage;
  const failure = new Error("index page read failed");
  const release = Promise.withResolvers();
  const failed = Promise.withResolvers();
  let active = 0;
  let started = 0;
  let settled = false;
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
    .getMany(
      root,
      entries.map(([key]) => key),
    )
    .then(
      () => {
        settled = true;
        assert.fail("lookup must reject");
      },
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
});
