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
import { IMMUTABLE_CLEANUP_PLAN as PLAN } from "@noobot/session-protocol/immutable-storage";
import { ImmutableCleanupRetention } from "../../src/session/session-artifact-session/immutable-cleanup-retention.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { capturedImmutableCandidates } from "../helpers/immutable-cleanup-candidates.js";
import { observeSessionStorageWork } from "../../src/session/session-artifact-session/storage-transaction.js";
import { decodeImmutableRecordReference } from "@noobot/session-protocol/immutable-segment";

const identity = (index) => index.toString(16).padStart(32, "0");

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "cleanup-batch-filter-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return {
    directory,
    retained: new ImmutableCleanupRetention(path.join(directory, "retention"), {
      create: true,
    }),
  };
}

test("batch retention membership shares index reads and preserves missing and duplicate identities", async (t) => {
  const { directory, retained } = await fixture(t);
  const keys = Array.from({ length: PLAN.chunkEntries - 1 }, (_, i) => identity(i));
  for (const key of keys) await retained.add(key);
  await retained.flush();
  const reopened = new ImmutableCleanupRetention(path.join(directory, "retention"), {
    create: false,
  });
  const requested = [...keys.slice(0, -1), identity(PLAN.chunkEntries), keys[0]];
  const { result, work: batch } = await observeSessionStorageWork(() =>
    reopened.hasMany(requested),
  );
  assert.deepEqual(result, new Map(requested.map((key) => [key, keys.includes(key)])));
  const { work: sequential } = await observeSessionStorageWork(async () => {
    for (const key of requested) assert.equal(await reopened.has(key), keys.includes(key));
  });
  assert.ok(
    batch.immutableObjectReads < sequential.immutableObjectReads,
    JSON.stringify({ batch, sequential }),
  );
});

test("batch retention rejects oversize and malformed requests before reading storage", async (t) => {
  const { retained } = await fixture(t);
  retained.load = () => assert.fail("invalid or empty request must not read storage");
  assert.deepEqual(await retained.hasMany([]), new Map());
  await assert.rejects(retained.hasMany(Array(PLAN.chunkEntries + 1).fill(identity(0))), TypeError);
  await assert.rejects(retained.hasMany(["invalid"]), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
});

test("candidate filtering preserves live segments and captured chain order across batch boundaries", async (t) => {
  const { directory } = await fixture(t);
  const sessionDir = path.join(directory, "session");
  const store = new ImmutableSessionStore({
    sessionDir,
    sessionId: "batch-cleanup",
    allowCreate: true,
  });
  await store.commit({
    expectedGeneration: 0,
    operationId: "seed",
    changes: [{ collection: "metadata", key: "value", value: 1 }],
  });
  const head = await store.snapshot();
  const live = new Set();
  for await (const reference of store.objects.physicalReferences(head))
    live.add(`segments/${decodeImmutableRecordReference(reference).segmentId}.seg`);
  const files = Array.from(
    { length: PLAN.chunkEntries * 2 + 3 },
    (_, i) => `segments/${identity(i)}.seg`,
  );
  files.splice(PLAN.chunkEntries - 1, 0, ...live);
  const inventory = async function* () {
    yield* files;
  };
  const result = [];
  let retainedSegments;
  for await (const file of capturedImmutableCandidates({
    sessionDir,
    format: head.format,
    retainedHeads: [head],
    objects: store.objects,
    retentionDirectory: path.join(directory, "mark"),
    inventory: inventory(),
    onRetainedSegments: (count) => {
      retainedSegments = count;
    },
  }))
    result.push(file);
  const inventoryPages = [];
  for (let offset = 0; offset < files.length; offset += PLAN.chunkEntries)
    inventoryPages.push(files.slice(offset, offset + PLAN.chunkEntries));
  assert.deepEqual(
    result,
    inventoryPages
      .reverse()
      .flat()
      .filter((file) => !live.has(file)),
  );
  assert.equal(retainedSegments, live.size);
});
