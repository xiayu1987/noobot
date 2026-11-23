/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  ORDINAL_DIRECTORY_FANOUT,
  ordinalDirectoryPath,
  readDirectoryOrdinals,
  updateOrdinalDirectory,
} from "../src/ordinal-directory.js";

function fixture() {
  const pages = new Map([["", { ordinals: [] }]]);
  const reads = [];
  const directory = {
    getMany: async (prefixes) =>
      new Map(prefixes.map((prefix) => [prefix, pages.get(prefix) ?? null])),
    set: (prefix, page) => pages.set(prefix, structuredClone(page)),
    remove: (prefix) => pages.delete(prefix),
  };
  const read = (options) =>
    readDirectoryOrdinals(async (prefix) => {
      reads.push(prefix);
      return structuredClone(pages.get(prefix) ?? null);
    }, options);
  return { directory, pages, reads, read };
}

test("shared context directory splits, seeks sparse ordinals and prunes all retired pages", async () => {
  const { directory, pages, reads, read } = fixture();
  const ordinals = Array.from({ length: ORDINAL_DIRECTORY_FANOUT + 1 }, (_, index) => index + 1);
  ordinals.push(Number.MAX_SAFE_INTEGER);
  for (const ordinal of ordinals) await updateOrdinalDirectory(directory, ordinal, true);
  assert.ok(pages.size > 2);
  assert.deepEqual(await Array.fromAsync(read()), [...ordinals].reverse());
  reads.length = 0;
  assert.deepEqual(await Array.fromAsync(read({ before: 2 })), [1]);
  const excluded = ordinalDirectoryPath(Number.MAX_SAFE_INTEGER).slice(0, 2);
  assert.equal(
    reads.some((prefix) => prefix.startsWith(excluded)),
    false,
  );
  assert.ok(reads.length <= ordinalDirectoryPath(1).length / 2 + 1);
  assert.deepEqual(await Array.fromAsync(read({ after: 0 })), ordinals);
  reads.length = 0;
  assert.deepEqual(await Array.fromAsync(read({ after: Number.MAX_SAFE_INTEGER - 1 })), [
    Number.MAX_SAFE_INTEGER,
  ]);
  assert.equal(
    reads.some((prefix) => prefix !== "" && !prefix.startsWith(excluded)),
    false,
  );
  assert.deepEqual(await Array.fromAsync(read({ after: Number.MAX_SAFE_INTEGER })), []);
  await assert.rejects(Array.fromAsync(read({ after: 0, before: 0 })), TypeError);
  for (const ordinal of ordinals) await updateOrdinalDirectory(directory, ordinal, false);
  assert.deepEqual([...pages], [["", { ordinals: [] }]]);
  assert.deepEqual(await Array.fromAsync(read()), []);
});

test("shared context traversal rejects referenced corruption and preserves explicit cursors", async () => {
  const { directory, pages, read } = fixture();
  for (const ordinal of [1, 256, Number.MAX_SAFE_INTEGER])
    await updateOrdinalDirectory(directory, ordinal, true);
  assert.deepEqual(await Array.fromAsync(read({ before: 256 })), [1]);
  assert.deepEqual(await Array.fromAsync(read({ before: 1 })), []);
  for (const before of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, null])
    await assert.rejects(Array.fromAsync(read({ before })), TypeError);
  for (const present of [1, 0, "true", null, undefined])
    await assert.rejects(updateOrdinalDirectory(directory, 2, present), TypeError);
  const invalid = { code: "SESSION_STORAGE_CORRUPT" };
  await assert.rejects(updateOrdinalDirectory(directory, 1, true), invalid);
  await assert.rejects(updateOrdinalDirectory(directory, 2, false), invalid);
  pages.set("", { slots: [0] });
  await assert.rejects(Array.fromAsync(read()), invalid);
  pages.set("00", { ordinals: [Number.MAX_SAFE_INTEGER] });
  await assert.rejects(Array.fromAsync(read()), invalid);
  pages.set("00", { ordinals: [1, 1] });
  await assert.rejects(Array.fromAsync(read()), invalid);
});

test("shared context split rejects an orphan page instead of overwriting its evidence", async () => {
  const { directory, pages } = fixture();
  const ordinals = Array.from({ length: ORDINAL_DIRECTORY_FANOUT }, (_, index) => index + 1);
  pages.set("", { ordinals });
  const orphan = { ordinals: [1] };
  pages.set("00", orphan);
  await assert.rejects(updateOrdinalDirectory(directory, ORDINAL_DIRECTORY_FANOUT + 1, true), {
    code: "SESSION_STORAGE_CORRUPT",
  });
  assert.deepEqual(pages.get(""), { ordinals });
  assert.deepEqual(pages.get("00"), orphan);
});
