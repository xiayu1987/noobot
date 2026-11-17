/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { encodeImmutableSessionHead } from "@noobot/session-protocol/immutable-storage";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { immutableOrderKey } from "../../src/session/session-artifact-session/immutable-order-key.js";
import { observeSessionStorageWork } from "../../src/session/session-artifact-session/storage-transaction.js";

async function fixture(context) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-replay-integrity-"));
  context.after(() => rm(sessionDir, { recursive: true, force: true }));
  return new ImmutableSessionStore({ sessionDir, sessionId: "replay", allowCreate: true });
}

const request = (generation) => ({
  expectedGeneration: generation,
  operationId: `operation-${generation}`,
  changes: [{ collection: "messages", key: `message-${generation}`, value: { generation } }],
});

async function rewriteReceipt(store, head, commit, { indexed = false } = {}) {
  const receipt = await store.objects.withSnapshot(head, async () =>
    store.objects.readValue(await store.index.get(head.operations, "operation-0")),
  );
  return store.objects.withDurabilityBatch(async () => {
    store.objects.beginCommit(head);
    const reference = await store.objects.putValue(commit);
    const operations = await store.index.set(
      head.operations,
      "operation-0",
      await store.objects.putValue({ ...receipt, commit: reference }),
    );
    let root = head.root;
    if (indexed) {
      const commits = await store.index.set(
        await store.index.get(root, "commitOrder"),
        immutableOrderKey(1),
        reference,
      );
      root = await store.index.set(root, "commitOrder", commits);
    }
    await store.objects.publishReachable([operations, root, reference]);
    const changed = { ...head, operations, root, ...store.objects.publicationHeadFields() };
    await writeFile(store.headPath, encodeImmutableSessionHead(changed, store.format));
    return changed;
  });
}

for (const [name, mutate] of [
  ["missing mutations", ({ mutations, ...record }) => record],
  ["non-array mutations", (record) => ({ ...record, mutations: {} })],
  [
    "duplicate mutations",
    (record) => ({ ...record, mutations: [...record.mutations, record.mutations[0]] }),
  ],
  [
    "invalid mutation reference",
    (record) => ({ ...record, mutations: [{ ...record.mutations[0], reference: "invalid" }] }),
  ],
  [
    "unknown collection",
    (record) => ({ ...record, mutations: [{ ...record.mutations[0], collection: "unknown" }] }),
  ],
  ["extra commit fields", (record) => ({ ...record, extra: true })],
  ["invalid baseline predecessor", (record) => ({ ...record, previous: "f".repeat(64) })],
]) {
  test(`historical replay rejects ${name} even when the receipt and generation index agree`, async (context) => {
    const store = await fixture(context);
    const first = await store.commit(request(0));
    await store.commit(request(1));
    const head = await store.snapshot();
    const record = await store.objects.withSnapshot(head, () =>
      store.objects.readValue(first.commit),
    );
    const changed = await rewriteReceipt(store, head, mutate(record), { indexed: true });
    const before = await readFile(store.headPath);
    const selected = await store.readCommitReference(changed, 1);
    const receipt = await store.objects.withSnapshot(changed, async () =>
      store.objects.readValue(await store.index.get(changed.operations, "operation-0")),
    );
    assert.equal(selected, receipt.commit, "receipt and index select the same malformed record");
    await assert.rejects(store.commit(request(0)), { code: "SESSION_IMMUTABLE_STORAGE_INVALID" });
    assert.deepEqual(await readFile(store.headPath), before);
    assert.deepEqual(await store.snapshot(), changed);
  });
}

test("historical replay rejects a valid but unpublished commit with the same operation identity", async (context) => {
  const store = await fixture(context);
  const first = await store.commit(request(0));
  await store.commit(request(1));
  const head = await store.snapshot();
  const record = await store.objects.withSnapshot(head, () =>
    store.objects.readValue(first.commit),
  );
  await rewriteReceipt(store, head, { ...record, mutations: [] });
  const before = await readFile(store.headPath);
  await assert.rejects(store.commit(request(0)), { code: "SESSION_IMMUTABLE_STORAGE_INVALID" });
  assert.deepEqual(await readFile(store.headPath), before);
});

test("replay rejects a missing generation index for both current and historical receipts", async (context) => {
  const store = await fixture(context);
  await store.commit(request(0));
  await store.commit(request(1));
  const head = await store.snapshot();
  await store.objects.withDurabilityBatch(async () => {
    store.objects.beginCommit(head);
    const root = await store.index.set(head.root, "commitOrder", null);
    await store.objects.publishReachable([root, head.operations, head.commit]);
    await writeFile(
      store.headPath,
      encodeImmutableSessionHead(
        {
          ...head,
          root,
          ...store.objects.publicationHeadFields(),
        },
        store.format,
      ),
    );
  });
  const before = await readFile(store.headPath);
  for (const generation of [0, 1])
    await assert.rejects(store.commit(request(generation)), {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    });
  assert.deepEqual(await readFile(store.headPath), before);
});

test("cold replay after restart reads only the selected receipt, indexed commit and bounded paths", async (context) => {
  const store = await fixture(context);
  const results = [];
  for (let generation = 0; generation < 40; generation += 1)
    results.push(await store.commit(request(generation)));
  const head = await readFile(store.headPath);
  const reopened = await ImmutableSessionStore.open({ sessionDir: store.sessionDir });
  const selected = results[17].commit;
  const snapshot = await reopened.snapshot();
  const receiptReference = await reopened.objects.withSnapshot(snapshot, () =>
    reopened.index.get(snapshot.operations, "operation-17"),
  );
  const readValue = reopened.objects.readValue.bind(reopened.objects);
  const valueReads = [];
  reopened.objects.readValue = async (reference) => {
    valueReads.push(reference);
    return readValue(reference);
  };
  reopened.index.entries = async function* () {
    assert.fail("Replay must use point lookups instead of scanning indexes");
  };
  const { result, work } = await observeSessionStorageWork(() => reopened.commit(request(17)));
  assert.deepEqual(result, { ...results[17], replayed: true });
  assert.deepEqual(
    valueReads,
    [receiptReference, selected],
    "read exactly the selected receipt and the commit directly referenced by its generation index",
  );
  for (const { commit } of results)
    if (commit !== selected) assert.ok(!valueReads.includes(commit), "do not read other commits");
  assert.ok(work.immutableIndexPageReads <= 12, JSON.stringify(work));
  assert.equal(Object.hasOwn(work, "immutableObjectWrites"), false);
  assert.equal(Object.hasOwn(work, "immutableHeadWriteBytes"), false);
  assert.deepEqual(await readFile(store.headPath), head);
});
