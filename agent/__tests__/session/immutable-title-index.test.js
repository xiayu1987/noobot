/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deriveSessionAutoTitle } from "@noobot/session-protocol";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { ImmutableSessionChanges } from "../../src/session/session-artifact-session/immutable-message-changes.js";
import {
  seedImmutableTitleIndex,
  requireImmutableTitleIndex,
  updateImmutableTitleCandidate,
  readImmutableIndexedTitle,
} from "../../src/session/session-artifact-session/immutable-title-index.js";
import { upgradeImmutableTitleIndex } from "../../src/session/session-artifact-session/immutable-title-index-upgrade.js";
import { immutableOrderKey } from "../../src/session/session-artifact-session/immutable-order-key.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { collectValueRecords, forbidRecordReads } from "./helpers/immutable-record-reads.js";

const record = (ordinal, content = `title-${ordinal}`) => ({
  ordinal,
  message: { sessionId: "s1", messageUid: `m${ordinal}`, role: "user", content },
});
async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-title-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "s1", allowCreate: true });
  return { store, sessionDir };
}

test("title candidates follow committed order across arbitrary insertions, edits and removals", async (t) => {
  const { store } = await fixture(t);
  await store.objects.withDurabilityBatch(async () => {
    store.objects.beginCommit(await store.snapshot());
    const plan = new ImmutableSessionChanges(async () => null);
    seedImmutableTitleIndex(plan);
    const records = new Map();
    const positions = Array.from({ length: 128 }, (_, i) => ((i * 37) % 128) + 1);
    positions.push(Number.MAX_SAFE_INTEGER);
    const assertTitle = async () => {
      const ordered = [...records.values()].sort((a, b) => a.ordinal - b.ordinal);
      assert.equal(
        await readImmutableIndexedTitle(store, plan),
        deriveSessionAutoTitle(ordered.map((r) => r.message)),
      );
    };
    for (const ordinal of positions) {
      const next = record(ordinal);
      await updateImmutableTitleCandidate(store, plan, null, next);
      plan.set("messages", next.message.messageUid, next);
      records.set(ordinal, next);
      await assertTitle();
    }
    for (const ordinal of positions.slice().reverse()) {
      const previous = records.get(ordinal);
      const next = { ...previous, message: { ...previous.message, content: "" } };
      await updateImmutableTitleCandidate(store, plan, previous, next);
      plan.set("messages", next.message.messageUid, next);
      records.set(ordinal, next);
      await assertTitle();
    }
    assert.equal((await requireImmutableTitleIndex(plan, store.requireReference)).root, null);
  });
});

test("title index reads one source message and preserves prior roots while candidate text changes", async (t) => {
  const { store } = await fixture(t);
  await store.objects.withDurabilityBatch(async () => {
    store.objects.beginCommit(await store.snapshot());
    const plan = new ImmutableSessionChanges(async () => null);
    seedImmutableTitleIndex(plan);
    for (let ordinal = 1; ordinal <= 256; ordinal += 1) {
      const next = record(ordinal);
      await updateImmutableTitleCandidate(store, plan, null, next);
      plan.set("messages", next.message.messageUid, next);
    }
    const previous = await plan.get("messages", "m1");
    const edited = { ...previous, message: { ...previous.message, content: "edited" } };
    const root = (await requireImmutableTitleIndex(plan, store.requireReference)).root;
    await updateImmutableTitleCandidate(store, plan, previous, edited);
    plan.set("messages", "m1", edited);
    assert.equal((await requireImmutableTitleIndex(plan, store.requireReference)).root, root);
    const requested = [];
    const selected = {
      get: async (collection, key) => {
        if (collection === "messages") requested.push(key);
        return plan.get(collection, key);
      },
    };
    assert.equal(await readImmutableIndexedTitle(store, selected), "edited");
    assert.deepEqual(requested, ["m1"]);
    const old = new Map(plan.pending);
    const oldPlan = new ImmutableSessionChanges(
      async (collection, key) => old.get(JSON.stringify([collection, key]))?.value ?? null,
    );
    await updateImmutableTitleCandidate(store, plan, edited, null);
    plan.remove("messages", "m1");
    assert.equal(await readImmutableIndexedTitle(store, plan), "title-2");
    assert.equal(await readImmutableIndexedTitle(store, oldPlan), "edited");
  });
});

test("missing versions, invalid pages and stale title sources fail explicitly", async (t) => {
  const { store } = await fixture(t);
  await store.objects.withDurabilityBatch(async () => {
    store.objects.beginCommit(await store.snapshot());
    const plan = new ImmutableSessionChanges(async () => null);
    await assert.rejects(requireImmutableTitleIndex(plan, store.requireReference), {
      code: "SESSION_IMMUTABLE_INDEX_UPGRADE_REQUIRED",
    });
    plan.set("metadata", "titleIndex", { version: 2, root: null });
    await assert.rejects(requireImmutableTitleIndex(plan, store.requireReference), {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    });
    seedImmutableTitleIndex(plan);
    const next = record(1);
    await updateImmutableTitleCandidate(store, plan, null, next);
    await assert.rejects(readImmutableIndexedTitle(store, plan), /missing or reordered/);
    const bad = await store.objects.put(
      Buffer.from(
        JSON.stringify({
          kind: "title-branch",
          prefix: "x",
          zero: null,
          one: null,
        }),
      ),
    );
    plan.set("metadata", "titleIndex", { version: 1, root: bad });
    await assert.rejects(readImmutableIndexedTitle(store, plan), /Invalid title index page/);
  });
});

test("offline title upgrade publishes once, isolates failure and skips history after completion", async (t) => {
  const { store, sessionDir } = await fixture(t);
  const source = [record(1, ""), record(2), record(3)];
  await store.commit({
    expectedGeneration: 0,
    operationId: "seed",
    changes: [
      { collection: "metadata", key: "facts", value: { messageSequence: 3, messageCount: 3 } },
      ...source.flatMap((r) => [
        { collection: "messages", key: r.message.messageUid, value: r },
        {
          collection: "messageOrder",
          key: immutableOrderKey(r.ordinal),
          value: r.message.messageUid,
        },
      ]),
    ],
  });
  const before = await store.snapshot();
  const options = { sessionDir, sessionId: "s1" };
  setFsAdapter({
    rename: async (from, to) => {
      if (to === store.headPath) throw Object.assign(new Error("injected"), { code: "EIO" });
      return rename(from, to);
    },
  });
  try {
    await assert.rejects(upgradeImmutableTitleIndex(options), { code: "SESSION_COMMIT_UNCERTAIN" });
  } finally {
    resetFsAdapter();
  }
  assert.deepEqual(await store.snapshot(), before);
  assert.equal(await store.get(before, "metadata", "titleIndex"), null);
  assert.equal((await upgradeImmutableTitleIndex(options)).result.upgraded, true);
  const snapshot = await store.snapshot();
  const plan = new ImmutableSessionChanges((collection, key) =>
    store.get(snapshot, collection, key),
  );
  assert.equal(
    await store.objects.withSnapshot(snapshot, () => readImmutableIndexedTitle(store, plan)),
    "title-2",
  );
  const forbidden = new Set();
  await store.objects.withSnapshot(snapshot, async () => {
    for (const r of source) {
      const reference = await store.index.get(
        await store.index.get(snapshot.root, "messages"),
        r.message.messageUid,
      );
      await collectValueRecords(store, reference, forbidden);
    }
  });
  setFsAdapter(await forbidRecordReads(store, forbidden));
  try {
    assert.equal((await upgradeImmutableTitleIndex(options)).aborted, true);
    assert.deepEqual(await store.snapshot(), snapshot);
  } finally {
    resetFsAdapter();
  }
});
