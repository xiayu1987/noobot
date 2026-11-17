/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import {
  readImmutableListProjection,
  upgradeImmutableListProjection,
} from "../../src/session/session-artifact-session/immutable-list-projection.js";
import { corruptRecord } from "./helpers/immutable-record-reads.js";

async function fixture(t, facts) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-list-retirement-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "list", allowCreate: true });
  await store.commit({
    expectedGeneration: 0,
    operationId: "legacy",
    changes: [
      { collection: "metadata", key: "facts", value: facts },
      {
        collection: "metadata",
        key: "listProjection",
        value: { messageCount: 99, lastMessage: { content: "stale duplicate" } },
      },
    ],
  });
  return { store, sessionDir, sessionId: store.sessionId };
}

test("retirement removes the current duplicate, preserves history and is idempotent", async (t) => {
  const options = await fixture(t, { messageCount: 0, lastMessageUid: "" });
  const { store } = options;
  const previous = await store.snapshot();
  await upgradeImmutableListProjection(options);
  const current = await store.snapshot();
  assert.equal(current.generation, previous.generation + 1);
  assert.equal(await store.get(current, "metadata", "listProjection"), null);
  assert.equal(
    (await store.get(previous, "metadata", "listProjection")).lastMessage.content,
    "stale duplicate",
  );
  assert.deepEqual(
    await readImmutableListProjection((collection, key) => store.get(current, collection, key)),
    { messageCount: 0, lastMessage: null },
  );
  const head = await readFile(store.headPath);
  await upgradeImmutableListProjection(options);
  assert.deepEqual(await readFile(store.headPath), head);
});

test("retirement never reads the obsolete body", async (t) => {
  const options = await fixture(t, { messageCount: 0, lastMessageUid: "" });
  const { store } = options;
  const previous = await store.snapshot();
  const reference = await store.objects.withSnapshot(previous, async () =>
    store.index.get(await store.index.get(previous.root, "metadata"), "listProjection"),
  );
  await corruptRecord(store, reference);
  await upgradeImmutableListProjection(options);
  assert.equal(await store.get(await store.snapshot(), "metadata", "listProjection"), null);
  await assert.rejects(store.get(previous, "metadata", "listProjection"), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
});

for (const facts of [
  { messageCount: 1, lastMessageUid: "" },
  { messageCount: 1, lastMessageUid: "missing" },
]) {
  test(`retirement rejects invalid authority without publishing a head: ${JSON.stringify(facts)}`, async (t) => {
    const options = await fixture(t, facts);
    const head = await readFile(options.store.headPath);
    await assert.rejects(upgradeImmutableListProjection(options), {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    });
    assert.deepEqual(await readFile(options.store.headPath), head);
    assert.ok(
      await options.store.get(await options.store.snapshot(), "metadata", "listProjection"),
    );
  });
}
