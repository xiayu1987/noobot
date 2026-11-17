/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { immutableCheckpointKey } from "../../src/session/session-artifact-session/immutable-checkpoint-index.js";
import { immutableOrderKey } from "../../src/session/session-artifact-session/immutable-order-key.js";
import {
  readImmutableCheckpoint,
  readImmutableCheckpointPage,
  readImmutableCheckpointState,
} from "../../src/session/session-artifact-session/immutable-checkpoint-reader.js";

const INVALID = { code: "SESSION_IMMUTABLE_STORAGE_INVALID" };
const header = { turnScopeId: "t1", dialogProcessId: "d1", checkpointRevision: 3 };
function receipt(revision) {
  return {
    checkpointId: `cp${revision}`,
    checkpointRevision: revision,
    requestHash: `hash-${revision}`,
    committedAt: "2026-01-01T00:00:00.000Z",
    markedCount: 1,
    persistedMessageUids: [`m${revision}`],
    summarizedMessageUids: [`m${revision}`],
    retainedMessageUids: [],
  };
}

async function fixture(t, { head = header, receipts = [receipt(1), receipt(2), receipt(3)] } = {}) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "checkpoint-reader-integrity-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "s1", allowCreate: true });
  await store.commit({
    expectedGeneration: 0,
    operationId: "seed",
    changes: [
      { collection: "checkpointHeads", key: "t1", value: head },
      ...receipts.flatMap((value, index) => [
        { collection: "checkpoints", key: immutableCheckpointKey("t1", `cp${index + 1}`), value },
        {
          collection: "checkpointOrder",
          key: immutableCheckpointKey("t1", immutableOrderKey(index + 1)),
          value: `cp${index + 1}`,
        },
      ]),
    ],
  });
  const cold = new ImmutableSessionStore({ sessionDir, sessionId: "s1" });
  return { store: cold, snapshot: await cold.snapshot() };
}

for (const [name, invalid] of [
  ["missing request hash", { ...receipt(1), requestHash: undefined }],
  ["negative marked count", { ...receipt(1), markedCount: -1 }],
  ["invalid commit timestamp", { ...receipt(1), committedAt: " " }],
  ["missing persisted UIDs", { ...receipt(1), persistedMessageUids: undefined }],
  ["duplicate summarized UIDs", { ...receipt(1), summarizedMessageUids: ["m1", "m1"] }],
  ["invalid retained UIDs", { ...receipt(1), retainedMessageUids: [""] }],
]) {
  test(`cold checkpoint reads reject protocol-invalid receipts: ${name}`, async (t) => {
    const { store, snapshot } = await fixture(t, { receipts: [invalid] });
    await assert.rejects(readImmutableCheckpoint(store, snapshot, "t1", "cp1"), INVALID);
    await assert.rejects(
      readImmutableCheckpointPage({ store, snapshot, turnScopeId: "t1", limit: 1 }),
      INVALID,
    );
    await assert.rejects(readImmutableCheckpointState(store, snapshot, "t1"), INVALID);
    assert.deepEqual(await store.snapshot(), snapshot);
  });
}

test("all checkpoint read entries reject a header without protocol ownership", async (t) => {
  const { store, snapshot } = await fixture(t, { head: { ...header, dialogProcessId: "" } });
  await assert.rejects(readImmutableCheckpoint(store, snapshot, "t1", "cp1"), INVALID);
  await assert.rejects(
    readImmutableCheckpointPage({ store, snapshot, turnScopeId: "t1" }),
    INVALID,
  );
  await assert.rejects(readImmutableCheckpointState(store, snapshot, "t1"), INVALID);
});

test("named receipt reads reject missing or foreign revision entries without scanning history", async (t) => {
  for (const value of [null, "cp2"]) {
    const { store, snapshot } = await fixture(t);
    await store.commit({
      expectedGeneration: snapshot.generation,
      operationId: "break-order",
      changes: [
        {
          collection: "checkpointOrder",
          key: immutableCheckpointKey("t1", immutableOrderKey(1)),
          ...(value === null ? { remove: true } : { value }),
        },
      ],
    });
    await assert.rejects(
      readImmutableCheckpoint(store, await store.snapshot(), "t1", "cp1"),
      INVALID,
    );
  }
});

test("page and state reads load their pinned header once and only access requested receipts", async (t) => {
  const { store, snapshot } = await fixture(t);
  const get = store.get.bind(store);
  const getMany = store.getMany.bind(store);
  const calls = [];
  t.mock.method(store, "get", async (pinned, collection, key) => {
    assert.equal(pinned, snapshot);
    calls.push([collection, key]);
    return get(pinned, collection, key);
  });
  const batches = [];
  t.mock.method(store, "getMany", async (pinned, collection, keys) => {
    assert.equal(pinned, snapshot);
    batches.push([collection, keys]);
    return getMany(pinned, collection, keys);
  });
  const page = await readImmutableCheckpointPage({
    store,
    snapshot,
    turnScopeId: "t1",
    after: 1,
    limit: 2,
  });
  assert.deepEqual(page.receipts, [receipt(2), receipt(3)]);
  assert.equal(calls.filter(([collection]) => collection === "checkpointHeads").length, 1);
  assert.deepEqual(batches.find(([collection]) => collection === "checkpoints")[1], [
    immutableCheckpointKey("t1", "cp2"),
    immutableCheckpointKey("t1", "cp3"),
  ]);
  assert.equal(calls.length, 1);
  assert.equal(batches.length, 2);
  calls.length = 0;
  batches.length = 0;
  assert.deepEqual(await readImmutableCheckpointState(store, snapshot, "t1"), {
    ...header,
    receipts: [receipt(1), receipt(2), receipt(3)],
  });
  assert.equal(calls.filter(([collection]) => collection === "checkpointHeads").length, 1);
  assert.equal(calls.length, 1);
  assert.equal(batches.length, 2);
});

test("batched pages preserve sparse revision order and pinned snapshots", async (t) => {
  const { store, snapshot } = await fixture(t);
  await store.commit({
    expectedGeneration: snapshot.generation,
    operationId: "remove-middle",
    changes: [
      {
        collection: "checkpointOrder",
        key: immutableCheckpointKey("t1", immutableOrderKey(2)),
        remove: true,
      },
      { collection: "checkpoints", key: immutableCheckpointKey("t1", "cp2"), remove: true },
    ],
  });
  const current = await store.snapshot();
  assert.deepEqual((await readImmutableCheckpointState(store, snapshot, "t1")).receipts, [
    receipt(1),
    receipt(2),
    receipt(3),
  ]);
  const page = await readImmutableCheckpointPage({
    store,
    snapshot: current,
    turnScopeId: "t1",
    limit: 2,
  });
  assert.deepEqual(page.receipts, [receipt(1)]);
  assert.equal(page.cursor, 2);
  assert.equal(page.hasMore, true);
  const last = await readImmutableCheckpointPage({
    store,
    snapshot: current,
    turnScopeId: "t1",
    after: 2,
    limit: 2,
  });
  assert.deepEqual(last.receipts, [receipt(3)]);
  assert.equal(last.hasMore, false);
  const empty = await readImmutableCheckpointPage({
    store,
    snapshot: current,
    turnScopeId: "t1",
    after: 9,
  });
  assert.deepEqual(empty.receipts, []);
  assert.equal(empty.cursor, 9);
});

for (const corruption of ["missing-receipt", "wrong-revision", "wrong-identity"]) {
  test(`batched checkpoint pages reject ${corruption}`, async (t) => {
    const { store, snapshot } = await fixture(t);
    await store.commit({
      expectedGeneration: snapshot.generation,
      operationId: corruption,
      changes: [
        {
          collection: "checkpoints",
          key: immutableCheckpointKey("t1", "cp2"),
          ...(corruption === "missing-receipt"
            ? { remove: true }
            : {
                value: {
                  ...receipt(2),
                  ...(corruption === "wrong-revision"
                    ? { checkpointRevision: 1 }
                    : { checkpointId: "foreign" }),
                },
              }),
        },
      ],
    });
    const current = await store.snapshot();
    await assert.rejects(
      readImmutableCheckpointPage({ store, snapshot: current, turnScopeId: "t1" }),
      INVALID,
    );
    await assert.rejects(readImmutableCheckpointState(store, current, "t1"), INVALID);
  });
}
