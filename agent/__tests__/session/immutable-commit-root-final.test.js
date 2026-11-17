/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import {
  applyImmutableCommitMutations,
  indexImmutableCommit,
  buildImmutableCommitRoot,
} from "../../src/session/session-artifact-session/immutable-commit-roots.js";
import {
  ImmutableRadixIndex,
  readImmutableIndexPages,
  validateImmutableIndexPage,
} from "../../src/session/session-artifact-session/immutable-radix-index.js";
import { contentDigest } from "../../src/session/session-artifact-session/immutable-storage-io.js";
import { requireImmutableContentDigest } from "@noobot/session-protocol/immutable-segment";

function fixture() {
  const pages = new Map();
  const objects = {
    requireReference: requireImmutableContentDigest,
    readIndexPages(nodes) {
      return readImmutableIndexPages(this, nodes);
    },
    async putIndexPage(page, prefix) {
      validateImmutableIndexPage(page, prefix, requireImmutableContentDigest);
      const reference = contentDigest(JSON.stringify(page));
      pages.set(reference, structuredClone(page));
      return reference;
    },
    async readIndexPage(reference, prefix) {
      return validateImmutableIndexPage(
        pages.get(reference),
        prefix,
        requireImmutableContentDigest,
      );
    },
    async putValue(value) {
      return contentDigest(JSON.stringify(value));
    },
  };
  return { objects, index: new ImmutableRadixIndex(objects) };
}

test("final root construction equals historical replay across additions, removals and commit-order upgrades", async () => {
  const { objects, index } = fixture();
  let previousRoot = null;
  for (let generation = 1; generation <= 40; generation += 1) {
    const mutations = [
      { collection: "metadata", key: "state", reference: contentDigest(`state-${generation}`) },
      {
        collection: "messages",
        key: `message-${generation}`,
        reference: contentDigest(`message-${generation}`),
      },
    ];
    if (generation > 1)
      mutations.push({ collection: "messages", key: `message-${generation - 1}`, reference: null });
    if (generation === 20)
      mutations.push({
        collection: "commitOrder",
        key: "00000000000000000000",
        reference: contentDigest("upgrade-entry"),
      });
    const options = {
      objects,
      index,
      previousRoot,
      generation,
      mutations,
      commit: contentDigest(`commit-${generation}`),
    };
    const intermediate = await applyImmutableCommitMutations(options);
    const expected = await indexImmutableCommit({ ...options, root: intermediate });
    const original = index.setMany.bind(index);
    const rootUpdates = [];
    index.setMany = async (root, entries) => {
      if (root === previousRoot) rootUpdates.push(entries);
      return original(root, entries);
    };
    try {
      const actual = await buildImmutableCommitRoot(options);
      assert.equal(actual, expected, `generation ${generation}`);
      if (generation > 1) assert.equal(rootUpdates.length, 1);
      previousRoot = actual;
    } finally {
      index.setMany = original;
    }
  }
});

test("collection preparation drains admitted siblings before rejecting and never publishes a partial root", async () => {
  const failure = new Error("collection index failed");
  const release = Promise.withResolvers();
  const entered = Promise.withResolvers();
  let active = 0;
  let maximum = 0;
  let published = false;
  let settled = false;
  const index = {
    async getMany(root, keys) {
      return new Map(keys.map((key) => [key, key]));
    },
    async setMany(root) {
      if (root === "root") {
        published = true;
        return "published";
      }
      active += 1;
      maximum = Math.max(maximum, active);
      try {
        if (root === "metadata") {
          await entered.promise;
          throw failure;
        }
        entered.resolve();
        await release.promise;
        return `${root}-updated`;
      } finally {
        active -= 1;
      }
    },
  };
  const pending = applyImmutableCommitMutations({
    index,
    objects: {},
    previousRoot: "root",
    generation: 1,
    origins: {},
    mutations: [
      { collection: "metadata", key: "a", reference: "a" },
      { collection: "messages", key: "b", reference: "b" },
    ],
  }).then(
    () => assert.fail("must reject"),
    (error) => {
      settled = true;
      return error;
    },
  );
  await entered.promise;
  await setImmediate();
  assert.ok(maximum > 1);
  assert.equal(settled, false);
  assert.equal(published, false);
  release.resolve();
  assert.equal(await pending, failure);
  assert.equal(active, 0);
  assert.equal(published, false);
});
