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
import { deriveSessionAutoTitle, SESSION_AUTO_TITLE_MAX_LENGTH } from "@noobot/session-protocol";
import { IMMUTABLE_TITLE_INDEX_VERSION } from "@noobot/session-protocol/immutable-storage";
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
      get: plan.get.bind(plan),
      getMetadata: (collection, key) => {
        requested.push(key);
        return plan.getMetadata(collection, key);
      },
    };
    assert.equal(await readImmutableIndexedTitle(store, selected), "edited");
    assert.deepEqual(requested, ["m1"]);
    const old = new Map(plan.pending);
    const oldPlan = new ImmutableSessionChanges(async () => null);
    oldPlan.pending = old;
    await updateImmutableTitleCandidate(store, plan, edited, null);
    plan.remove("messages", "m1");
    assert.equal(await readImmutableIndexedTitle(store, plan), "title-2");
    assert.equal(await readImmutableIndexedTitle(store, oldPlan), "edited");
  });
});

test("current title lookup rejects ineligible candidates instead of searching later messages", async (t) => {
  const { store } = await fixture(t);
  await store.objects.withDurabilityBatch(async () => {
    store.objects.beginCommit(await store.snapshot());
    const plan = new ImmutableSessionChanges(async () => null);
    seedImmutableTitleIndex(plan);
    const first = record(1);
    await updateImmutableTitleCandidate(store, plan, null, first);
    plan.set("messages", "m1", record(1, `${" ".repeat(SESSION_AUTO_TITLE_MAX_LENGTH)}text`));
    const second = record(2);
    await updateImmutableTitleCandidate(store, plan, null, second);
    plan.set("messages", "m2", second);
    await assert.rejects(readImmutableIndexedTitle(store, plan), /no longer eligible/);
  });
});

test("missing versions, invalid pages and stale title sources fail explicitly", async (t) => {
  const { store } = await fixture(t);
  await store.objects.withDurabilityBatch(async () => {
    store.objects.beginCommit(await store.snapshot());
    const plan = new ImmutableSessionChanges(async () => null, { getMetadata: async () => null });
    await assert.rejects(requireImmutableTitleIndex(plan, store.requireReference), {
      code: "SESSION_IMMUTABLE_INDEX_UPGRADE_REQUIRED",
    });
    plan.set("metadata", "titleIndex", { version: 999, root: null });
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
    plan.set("metadata", "titleIndex", { version: IMMUTABLE_TITLE_INDEX_VERSION, root: bad });
    await assert.rejects(readImmutableIndexedTitle(store, plan), /Invalid title index page/);
  });
});

test("offline title upgrade rebuilds published V1, isolates failure and skips history after completion", async (t) => {
  const { store, sessionDir } = await fixture(t);
  const source = [record(1, `${" ".repeat(SESSION_AUTO_TITLE_MAX_LENGTH)}text`), record(2)];
  const metadata = { sessionId: "s1", autoTitle: "published title" };
  await store.transact({
    expectedGeneration: 0,
    operationId: "seed",
    input: {},
    prepare: async () => {
      const zero = await store.objects.putPage({ kind: "title-candidate", uid: "m1", ordinal: 1 });
      const one = await store.objects.putPage({ kind: "title-candidate", uid: "m2", ordinal: 2 });
      const root = await store.objects.putPage({
        kind: "title-branch",
        prefix: "0".repeat(51),
        zero,
        one,
      });
      return {
        result: null,
        changes: [
          { collection: "metadata", key: "titleIndex", value: { version: 1, root } },
          { collection: "metadata", key: "session", value: metadata },
          { collection: "metadata", key: "facts", value: { messageSequence: 2, messageCount: 2 } },
          ...source.flatMap((r) => [
            { collection: "messages", key: r.message.messageUid, value: r },
            {
              collection: "messageOrder",
              key: immutableOrderKey(r.ordinal),
              value: r.message.messageUid,
            },
          ]),
        ],
      };
    },
  });
  const before = await store.snapshot();
  const lookup = (snapshot) => {
    const plan = new ImmutableSessionChanges(
      (collection, key) => store.get(snapshot, collection, key),
      {
        getMetadata: async (collection, key) =>
          (await store.getManyMetadata(snapshot, collection, [key])).get(key),
      },
    );
    return store.objects.withSnapshot(snapshot, () => readImmutableIndexedTitle(store, plan));
  };
  await assert.rejects(lookup(before), { code: "SESSION_IMMUTABLE_INDEX_UPGRADE_REQUIRED" });
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
  assert.equal((await store.get(before, "metadata", "titleIndex")).version, 1);
  assert.equal((await upgradeImmutableTitleIndex(options)).result.upgraded, true);
  const snapshot = await store.snapshot();
  assert.equal(snapshot.generation, before.generation + 1);
  assert.equal(await lookup(snapshot), "title-2");
  assert.deepEqual(await store.get(snapshot, "metadata", "session"), metadata);
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
