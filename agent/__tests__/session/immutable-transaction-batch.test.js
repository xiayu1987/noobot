/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { ImmutableSessionChanges } from "../../src/session/session-artifact-session/immutable-message-changes.js";

test("transaction batch lookup overlays additions, replacements and removals without reading pending keys", async (t) => {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-transaction-batch-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "batch", allowCreate: true });
  await store.commit({
    expectedGeneration: 0,
    operationId: "seed",
    changes: [
      { collection: "metadata", key: "unchanged", value: { n: 1 } },
      { collection: "metadata", key: "replace", value: { n: 2 } },
      { collection: "metadata", key: "remove", value: { n: 3 } },
    ],
  });
  const before = await store.snapshot();
  await store.transact({
    expectedGeneration: before.generation,
    operationId: "batch",
    input: {},
    prepare: async ({ get, getMany }) => {
      const calls = [];
      const plan = new ImmutableSessionChanges(get, {
        getMany: (collection, keys) => {
          calls.push({ collection, keys });
          return getMany(collection, keys);
        },
      });
      plan.set("metadata", "replace", { n: 20 });
      plan.set("metadata", "add", { n: 4 });
      plan.remove("metadata", "remove");
      assert.deepEqual(
        await plan.getMany("metadata", [
          "replace",
          "unchanged",
          "remove",
          "add",
          "missing",
          "unchanged",
        ]),
        new Map([
          ["replace", { n: 20 }],
          ["unchanged", { n: 1 }],
          ["remove", null],
          ["add", { n: 4 }],
          ["missing", null],
        ]),
      );
      assert.deepEqual(calls, [{ collection: "metadata", keys: ["unchanged", "missing"] }]);
      assert.deepEqual(await plan.getMany("metadata", []), new Map());
      plan.set("metadata", "replace", { n: 21 });
      assert.deepEqual(
        await plan.getMany("metadata", ["replace", "add"]),
        new Map([
          ["replace", { n: 21 }],
          ["add", { n: 4 }],
        ]),
      );
      assert.equal(calls.length, 1);
      return { changes: plan.changes(), result: null };
    },
  });
  const latest = await store.snapshot();
  assert.deepEqual(await store.get(latest, "metadata", "replace"), { n: 21 });
  assert.equal(await store.get(latest, "metadata", "remove"), null);
  assert.deepEqual(await store.get(before, "metadata", "replace"), { n: 2 });
});
