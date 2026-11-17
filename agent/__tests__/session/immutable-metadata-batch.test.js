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

test("metadata batch shares index paths without expanding message bodies and pins its snapshot", async (t) => {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-metadata-batch-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "batch", allowCreate: true });
  await store.commit({
    expectedGeneration: 0,
    operationId: "seed",
    changes: Array.from({ length: 64 }, (_, index) => ({
      collection: "messages",
      key: `message-${index}`,
      value: { message: { index, content: "body".repeat(16384) } },
    })),
  });
  const snapshot = await store.snapshot();
  const keys = ["message-31", "missing", "message-0", "message-31", "message-63"];
  let visits = 0;
  const readPage = store.index.readPage.bind(store.index);
  store.index.readPage = (...args) => {
    visits += 1;
    return readPage(...args);
  };
  const readValue = store.objects.readValue.bind(store.objects);
  store.objects.readValue = () => assert.fail("metadata reads must not expand content parts");
  const expected = new Map();
  for (const key of keys) {
    const single = await store.getManyMetadata(snapshot, "messages", [key]);
    expected.set(key, single.get(key));
  }
  const individualVisits = visits;
  visits = 0;
  const values = await store.getManyMetadata(snapshot, "messages", keys);
  assert.deepEqual(values, expected);
  assert.ok(visits < individualVisits);
  assert.equal(values.get("missing"), null);
  assert.equal(values.get("message-31").value.message.content, null);
  assert.equal(values.get("message-31").parts.length, 1);
  store.objects.readValue = readValue;
  await store.commit({
    expectedGeneration: snapshot.generation,
    operationId: "replace",
    changes: [{ collection: "messages", key: "message-31", remove: true }],
  });
  assert.deepEqual(await store.getManyMetadata(snapshot, "messages", keys), expected);
  assert.equal(
    (await store.getManyMetadata(await store.snapshot(), "messages", keys)).get("message-31"),
    null,
  );
  assert.deepEqual(await store.getManyMetadata(snapshot, "messages", []), new Map());
  await assert.rejects(store.getManyMetadata(snapshot, "messages", [""]), /Invalid/);
});

test("metadata batches respect pending changes, removals and later presentation demotion", async () => {
  const calls = [];
  const committed = {
    value: { message: { chatPresentation: true, content: null } },
    parts: [{ path: ["message", "content"], reference: "body" }],
  };
  const plan = new ImmutableSessionChanges(() => assert.fail("unexpected full value read"), {
    getManyMetadata: async (collection, keys) => {
      calls.push([collection, keys]);
      return new Map(keys.map((key) => [key, key === "missing" ? null : committed]));
    },
  });
  plan.set("messages", "pending", { changed: true });
  plan.remove("messages", "removed");
  const values = await plan.getManyMetadata("messages", [
    "committed",
    "pending",
    "removed",
    "missing",
    "committed",
  ]);
  assert.deepEqual(calls, [["messages", ["committed", "missing"]]]);
  assert.deepEqual(values.get("pending"), { value: { changed: true }, parts: [] });
  assert.equal(values.get("removed"), null);
  assert.equal(values.get("missing"), null);
  plan.set(
    "messages",
    "committed",
    { message: { chatPresentation: false, content: null } },
    committed.parts,
  );
  assert.equal(
    plan.resolveMetadata("messages", "committed", () => values.get("committed")).value.message
      .chatPresentation,
    false,
  );
  plan.remove("messages", "committed");
  assert.equal(
    plan.resolveMetadata("messages", "committed", () => values.get("committed")),
    null,
  );
});
