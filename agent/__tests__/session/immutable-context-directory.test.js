/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  ordinalDirectoryPath,
  requireOrdinalDirectoryPage,
} from "@noobot/session-protocol/ordinal-directory";
import {
  readImmutableContextDialogs,
  seedImmutableContextDirectory,
  updateImmutableContextDirectory,
} from "../../src/session/session-artifact-session/immutable-context-directory.js";

const invalid = { code: "SESSION_STORAGE_CORRUPT" };
const immutableInvalid = { code: "SESSION_IMMUTABLE_STORAGE_INVALID" };

function fixture() {
  const values = new Map();
  const identity = (collection, key) => JSON.stringify([collection, key]);
  const plan = {
    get: async (collection, key) => values.get(identity(collection, key)) ?? null,
    getMany: async (collection, keys) =>
      new Map(keys.map((key) => [key, values.get(identity(collection, key)) ?? null])),
    set: (collection, key, value) => values.set(identity(collection, key), value),
    remove: (collection, key) => values.delete(identity(collection, key)),
  };
  seedImmutableContextDirectory(plan);
  return { plan, values };
}

test("ordered directory crosses byte boundaries and skips arbitrarily large ordinal holes", async () => {
  const { plan, values } = fixture();
  const ordinals = [1, 255, 256, 65536, Number.MAX_SAFE_INTEGER];
  for (const ordinal of ordinals) {
    await updateImmutableContextDirectory(plan, ordinal, true);
    const id = `dialog-${ordinal}`;
    plan.set("dialogOrder", String(ordinal).padStart(16, "0"), id);
    plan.set("dialogs", id, { dialogProcessId: id, dialogOrdinal: ordinal });
  }
  const store = { get: (_snapshot, collection, key) => plan.get(collection, key) };
  const budget = { consume: () => {} };
  const read = async () => Array.fromAsync(readImmutableContextDialogs(store, {}, budget));
  assert.deepEqual(
    await read(),
    [...ordinals].reverse().map((n) => `dialog-${n}`),
  );
  for (const ordinal of ordinals) await updateImmutableContextDirectory(plan, ordinal, false);
  assert.deepEqual(await read(), []);
  assert.deepEqual(await plan.get("contextDialogRanges", "root"), { ordinals: [] });
  assert.equal([...values.keys()].filter((key) => key.includes("contextDialogRanges")).length, 1);
  await assert.rejects(updateImmutableContextDirectory(plan, 1, false), immutableInvalid);
});

test("duplicate additions and missing referenced pages are rejected", async () => {
  const { plan } = fixture();
  await updateImmutableContextDirectory(plan, 1, true);
  await assert.rejects(updateImmutableContextDirectory(plan, 1, true), immutableInvalid);
  plan.set("contextDialogRanges", "root", { slots: [0] });
  plan.remove("contextDialogRanges", "00");
  await assert.rejects(updateImmutableContextDirectory(plan, 2, true), immutableInvalid);
});

test("directory protocol rejects malformed slots, prefixes and ordinals", () => {
  for (const page of [
    null,
    {},
    { slots: [2, 1] },
    { slots: [1, 1] },
    { slots: [-1] },
    { slots: [256] },
    { slots: [0.5] },
    { slots: [], extra: true },
    { slots: [] },
    { ordinals: [2, 1] },
    { ordinals: [1, 1] },
    { ordinals: [0] },
    { ordinals: Array.from({ length: 257 }, (_, index) => index + 1) },
  ])
    assert.throws(() => requireOrdinalDirectoryPage(page, ""), invalid);
  assert.throws(() => requireOrdinalDirectoryPage({ slots: [] }, "00"), invalid);
  assert.throws(() => requireOrdinalDirectoryPage({ ordinals: [] }, "00"), invalid);
  assert.throws(() => requireOrdinalDirectoryPage({ ordinals: [256] }, "000000000000"), invalid);
  assert.throws(() => requireOrdinalDirectoryPage({ slots: [1] }, "0"), invalid);
  for (const ordinal of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => ordinalDirectoryPath(ordinal), invalid);
});
