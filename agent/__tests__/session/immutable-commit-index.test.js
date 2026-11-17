/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { IMMUTABLE_COMMIT_INDEX_VERSION } from "@noobot/session-protocol/immutable-storage-graph";
import { upgradeImmutableCommitIndex } from "../../src/session/session-artifact-session/immutable-commit-index-upgrade.js";
import { contentDigest } from "../../src/session/session-artifact-session/immutable-object-store.js";
import { immutableOrderKey } from "../../src/session/session-artifact-session/immutable-order-key.js";
import { resetFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { observeSessionStorageWork } from "../../src/session/session-artifact-session/storage-transaction.js";
import { forbidRecordReads } from "./helpers/immutable-record-reads.js";

async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "commit-index-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  return new ImmutableSessionStore({ sessionDir, sessionId: "s", allowCreate: true });
}

function commit(store, generation, changes) {
  return store.commit({ expectedGeneration: generation, operationId: `op-${generation}`, changes });
}

function query(store, snapshot, generation, collections = ["messages"]) {
  return store.readCommitChanges(snapshot, { generation, collections });
}

async function publishFault(store, prepare) {
  const head = await store.snapshot();
  return store.objects.withDurabilityBatch(async () => {
    store.objects.beginCommit(head);
    const { fields = {}, references = [], result } = await prepare(head);
    const changed = { ...head, ...fields };
    await store.objects.publishReachable([
      changed.root,
      changed.operations,
      changed.commit,
      ...references,
    ]);
    Object.assign(changed, store.objects.publicationHeadFields());
    const payload = JSON.stringify(changed);
    await writeFile(store.headPath, JSON.stringify({ payload, checksum: contentDigest(payload) }));
    return { snapshot: changed, result };
  });
}

async function removeIndexForUpgrade(store) {
  const { snapshot } = await publishFault(store, async (head) => {
    let root = await store.index.set(head.root, "commitOrder", null);
    const metadata = await store.index.set(
      await store.index.get(root, "metadata"),
      "commitIndex",
      null,
    );
    root = await store.index.set(root, "metadata", metadata);
    return { fields: { root } };
  });
  return snapshot;
}

test("indexed commit changes retain original values and deletions across later edits and restart", async (t) => {
  const store = await fixture(t);
  await commit(store, 0, [{ collection: "messages", key: "a", value: { text: "first" } }]);
  const pinned = await store.snapshot();
  await commit(store, 1, [
    { collection: "messages", key: "a", remove: true },
    { collection: "messages", key: "b", value: { text: "second" } },
    { collection: "metadata", key: "other", value: 123 },
  ]);
  const reopened = await ImmutableSessionStore.open({ sessionDir: store.sessionDir });
  const current = await reopened.snapshot();
  assert.deepEqual(await query(reopened, current, 1), {
    generation: 1,
    operationId: "op-0",
    changes: [{ collection: "messages", key: "a", value: { text: "first" } }],
  });
  assert.deepEqual((await query(reopened, current, 2)).changes, [
    { collection: "messages", key: "a", remove: true },
    { collection: "messages", key: "b", value: { text: "second" } },
  ]);
  assert.deepEqual(await query(reopened, pinned, 1), await query(reopened, current, 1));
  await assert.rejects(query(reopened, pinned, 2), TypeError);
  for (const collections of [[], ["messages", "messages"], ["unknown"], ["commitOrder"]])
    await assert.rejects(query(reopened, current, 1, collections), TypeError);
});

test("offline upgrade rebuilds historical generations with the same encoding as new commits", async (t) => {
  const store = await fixture(t);
  await commit(store, 0, [{ collection: "messages", key: "a", value: "first" }]);
  await commit(store, 1, [{ collection: "messages", key: "a", remove: true }]);
  const legacy = await removeIndexForUpgrade(store);
  const options = { sessionDir: store.sessionDir, sessionId: store.sessionId };
  const upgraded = await upgradeImmutableCommitIndex(options);
  assert.equal(upgraded.result.upgraded, true);
  assert.equal(upgraded.generation, 3);
  const pinned = await store.snapshot();
  assert.equal((await query(store, pinned, 1)).changes[0].value, "first");
  assert.equal((await query(store, pinned, 2)).changes[0].remove, true);
  assert.deepEqual(await query(store, pinned, 3), {
    generation: 3,
    operationId: "upgrade-commit-index:2",
    changes: [],
  });
  await assert.rejects(query(store, legacy, 1), { code: "SESSION_IMMUTABLE_STORAGE_INVALID" });
  const again = await upgradeImmutableCommitIndex(options);
  assert.equal(again.aborted, true);
  assert.equal((await store.snapshot()).generation, 3);
  await commit(store, 3, [{ collection: "messages", key: "b", value: "later" }]);
  const current = await store.snapshot();
  assert.equal((await query(store, current, 4)).changes[0].value, "later");
  assert.deepEqual(await query(store, current, 1), await query(store, pinned, 1));
});

test("failed upgrade publication leaves the old head and safely retries", async (t) => {
  const store = await fixture(t);
  await commit(store, 0, [{ collection: "messages", key: "a", value: 1 }]);
  const legacy = await removeIndexForUpgrade(store);
  const options = { sessionDir: store.sessionDir, sessionId: store.sessionId };
  setFsAdapter({
    rename: async (source, target) => {
      if (target === store.headPath) throw new Error("upgrade publication failed");
      return rename(source, target);
    },
  });
  try {
    await assert.rejects(upgradeImmutableCommitIndex(options), {
      code: "SESSION_COMMIT_UNCERTAIN",
    });
  } finally {
    resetFsAdapter();
  }
  assert.deepEqual(await store.snapshot(), legacy);
  await upgradeImmutableCommitIndex(options);
  assert.equal((await query(store, await store.snapshot(), 1)).changes[0].value, 1);
});

test("commit index rejects missing entries, wrong head references and malformed records", async (t) => {
  const store = await fixture(t);
  await commit(store, 0, [{ collection: "messages", key: "a", value: 1 }]);
  const head = await store.snapshot();
  const { snapshot: missing } = await publishFault(store, async () => ({
    fields: { root: await store.index.set(head.root, "commitOrder", null) },
  }));
  await assert.rejects(query(store, missing, 1), { code: "SESSION_IMMUTABLE_STORAGE_INVALID" });
  const record = await store.objects.withSnapshot(head, () => store.objects.readValue(head.commit));
  const validMutation = record.mutations[0];
  for (const invalid of [
    { ...record, generation: 2 },
    { ...record, previous: head.commit },
    { ...record, operationId: "" },
    { ...record, mutations: [validMutation, validMutation] },
    { ...record, mutations: [{ ...validMutation, reference: "bad" }] },
    { ...record, mutations: [{ ...validMutation, collection: "unknown" }] },
  ]) {
    const { snapshot, result: reference } = await publishFault(store, async () => {
      const result = await store.objects.putValue(invalid);
      return { references: [result], result };
    });
    await assert.rejects(
      store.objects.withSnapshot(snapshot, () => store.readCommitRecord(reference, 1)),
      {
        code: "SESSION_IMMUTABLE_STORAGE_INVALID",
      },
    );
  }
  const { snapshot: changed } = await publishFault(store, async () => {
    const other = await store.objects.putValue({ ...record, operationId: "other" });
    const indexRoot = await store.index.get(head.root, "commitOrder");
    const changedRoot = await store.index.set(
      indexRoot,
      immutableOrderKey(1),
      await store.objects.putValue(other),
    );
    return { fields: { root: await store.index.set(head.root, "commitOrder", changedRoot) } };
  });
  await assert.rejects(query(store, changed, 1), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
});

test("upgrade rejects unknown versions and broken predecessor chains without publishing", async (t) => {
  const store = await fixture(t);
  await commit(store, 0, [{ collection: "metadata", key: "session", value: {} }]);
  await commit(store, 1, [{ collection: "metadata", key: "commitIndex", value: { version: 999 } }]);
  const options = { sessionDir: store.sessionDir, sessionId: store.sessionId };
  const before = await store.snapshot();
  await assert.rejects(upgradeImmutableCommitIndex(options), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  assert.deepEqual(await store.snapshot(), before);
  const legacy = await removeIndexForUpgrade(store);
  await publishFault(store, async () => {
    const record = await store.objects.readValue(legacy.commit);
    return { fields: { commit: await store.objects.putValue({ ...record, previous: null }) } };
  });
  const broken = await store.snapshot();
  await assert.rejects(upgradeImmutableCommitIndex(options), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  assert.deepEqual(await store.snapshot(), broken);
});

test("command provenance upgrades version one and preserves baseline, updates, deletions and pinned reads", async (t) => {
  const store = await fixture(t);
  await commit(store, 0, [
    { collection: "commands", key: "imported", value: { id: "old" } },
    { collection: "commands", key: "removed", value: { id: "removed" } },
  ]);
  const baseline = await store.snapshot();
  const options = { sessionDir: store.sessionDir, sessionId: store.sessionId };
  assert.equal((await upgradeImmutableCommitIndex(options)).aborted, true);
  await commit(store, 1, [
    { collection: "commands", key: "live", value: { id: "new" } },
    { collection: "commands", key: "removed", remove: true },
  ]);
  await commit(store, 2, [
    { collection: "commands", key: "live", value: { id: "updated" } },
    { collection: "metadata", key: "commitIndex", value: { version: 1 } },
  ]);
  await publishFault(store, async (legacy) => ({
    fields: { root: await store.index.set(legacy.root, "commandCommits", null) },
  }));
  const upgraded = await upgradeImmutableCommitIndex(options);
  assert.equal(upgraded.result.upgraded, true);
  const pinned = await store.snapshot();
  assert.deepEqual(await store.get(pinned, "metadata", "commitIndex"), {
    version: IMMUTABLE_COMMIT_INDEX_VERSION,
  });
  assert.deepEqual(await store.get(pinned, "commandCommits", "imported"), {
    kind: "baseline",
    generation: 1,
  });
  assert.deepEqual(await store.get(pinned, "commandCommits", "live"), {
    kind: "commit",
    generation: 3,
  });
  assert.equal(await store.get(pinned, "commandCommits", "removed"), null);
  assert.equal(await store.get(baseline, "commandCommits", "live"), null);
  assert.equal((await upgradeImmutableCommitIndex(options)).aborted, true);
  await commit(store, 4, [{ collection: "commands", key: "live", remove: true }]);
  assert.equal(await store.get(await store.snapshot(), "commandCommits", "live"), null);
  assert.deepEqual(await store.get(pinned, "commandCommits", "live"), {
    kind: "commit",
    generation: 3,
  });
});

test("origin rebuild rejects missing, unrecorded and mismatched authoritative commands", async (t) => {
  const store = await fixture(t);
  await commit(store, 0, [{ collection: "commands", key: "a", value: { original: true } }]);
  await removeIndexForUpgrade(store);
  const head = await store.snapshot();
  for (const [key, value] of [
    ["a", null],
    ["a", { changed: true }],
    ["unrecorded", { extra: true }],
  ]) {
    const { snapshot: invalid } = await publishFault(store, async () => {
      const commands = await store.index.get(head.root, "commands");
      const reference = value === null ? null : await store.objects.putValue(value);
      const changed = await store.index.set(commands, key, reference);
      return { fields: { root: await store.index.set(head.root, "commands", changed) } };
    });
    await assert.rejects(
      upgradeImmutableCommitIndex({ sessionDir: store.sessionDir, sessionId: "s" }),
      {
        code: "SESSION_IMMUTABLE_STORAGE_INVALID",
      },
    );
    assert.deepEqual(await store.snapshot(), invalid);
  }
});

test("origin rebuild removes stale entries and retries publication without changing baseline provenance", async (t) => {
  const store = await fixture(t);
  await commit(store, 0, [{ collection: "commands", key: "a", value: { original: true } }]);
  await removeIndexForUpgrade(store);
  await publishFault(store, async (head) => {
    const origins = await store.index.get(head.root, "commandCommits");
    const changed = await store.index.set(
      origins,
      "stale",
      await store.objects.putValue({ kind: "commit", generation: 999 }),
    );
    return { fields: { root: await store.index.set(head.root, "commandCommits", changed) } };
  });
  const before = await store.snapshot();
  const options = { sessionDir: store.sessionDir, sessionId: "s" };
  setFsAdapter({
    rename: async (source, target) => {
      if (target === store.headPath) throw new Error("publication failed");
      return rename(source, target);
    },
  });
  try {
    await assert.rejects(upgradeImmutableCommitIndex(options), {
      code: "SESSION_COMMIT_UNCERTAIN",
    });
  } finally {
    resetFsAdapter();
  }
  assert.deepEqual(await store.snapshot(), before);
  await upgradeImmutableCommitIndex(options);
  const pinned = await store.snapshot();
  assert.equal(await store.get(pinned, "commandCommits", "stale"), null);
  assert.deepEqual(await store.get(pinned, "commandCommits", "a"), {
    kind: "baseline",
    generation: 1,
  });
  assert.equal((await upgradeImmutableCommitIndex(options)).aborted, true);
});

test("cold generation queries skip unrelated commits and unselected value bodies", async (t) => {
  const store = await fixture(t);
  const references = [];
  for (let generation = 0; generation < 96; generation += 1) {
    const outcome = await commit(store, generation, [
      { collection: "messages", key: `message-${generation}`, value: generation },
      { collection: "events", key: `event-${generation}`, value: { body: "x".repeat(10000) } },
    ]);
    references.push(outcome.commit);
  }
  const forbidden = references.filter((_, index) => index !== 47);
  const head = await store.snapshot();
  const eventReference = await store.objects.withSnapshot(head, async () =>
    store.index.get(await store.index.get(head.root, "events"), "event-47"),
  );
  forbidden.push(eventReference);
  setFsAdapter(await forbidRecordReads(store, forbidden));
  t.after(resetFsAdapter);
  const cold = await ImmutableSessionStore.open({ sessionDir: store.sessionDir });
  const { result, work } = await observeSessionStorageWork(() => query(cold, head, 48));
  assert.deepEqual(result.changes, [{ collection: "messages", key: "message-47", value: 47 }]);
  assert.ok(work.immutableIndexPageReads < 30, JSON.stringify(work));
  assert.ok(work.immutableReadBytes < 16384, JSON.stringify(work));
  resetFsAdapter();
  assert.equal((await query(cold, head, 48, ["events"])).changes[0].value.body.length, 10000);
});
