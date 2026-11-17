/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { ImmutableRecordStore } from "../../src/session/session-artifact-session/immutable-record-store.js";
import { ImmutableObjectStore } from "../../src/session/session-artifact-session/immutable-object-store.js";
import { ImmutableLocatedRecordStore } from "../../src/session/session-artifact-session/immutable-located-record-store.js";
import { migrateImmutableSessionSegments } from "../../src/session/session-artifact-session/immutable-segment-migration.js";
import { auditImmutableSession } from "../../src/session/session-artifact-session/immutable-session-audit.js";
import { acquireImmutableReaderRetention } from "../../src/session/session-artifact-session/immutable-reader-retention.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";

import { immutableOfflineBackend } from "../../src/session/session-artifact-session/immutable-storage-backends.js";
import { JsonLocatedFixture } from "../helpers/json-located-store.js";
import { wrapLegacyCommitIndex } from "../helpers/wrapped-commit-index.js";

const targetFormat = ImmutableLocatedRecordStore.format;
async function checkpointHistory(source) {
  const receipt = {
    checkpointId: "cp1",
    checkpointRevision: 1,
    requestHash: "hash-1",
    committedAt: "2026-01-01T00:00:00.000Z",
    markedCount: 0,
    persistedMessageUids: [],
    summarizedMessageUids: [],
    retainedMessageUids: [],
  };
  await source.commit({
    expectedGeneration: 2,
    operationId: "checkpoint-seed",
    changes: [
      { collection: "checkpoints", key: "cp1", value: receipt },
      { collection: "checkpoints", key: "cp2", value: { ...receipt, checkpointId: "cp2" } },
    ],
  });
  await source.commit({
    expectedGeneration: 3,
    operationId: "checkpoint-update",
    changes: [
      { collection: "checkpoints", key: "cp1", value: { ...receipt, requestHash: "hash-2" } },
      { collection: "checkpoints", key: "cp2", remove: true },
    ],
  });
}

async function fixture(t, objectStore) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "located-migration-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const source = new ImmutableSessionStore({
    sessionDir,
    sessionId: "migrate",
    allowCreate: true,
    objectStore,
  });
  const content = "中🙂".repeat(40000);
  const first = await source.commit({
    expectedGeneration: 0,
    operationId: "seed",
    changes: [
      { collection: "messages", key: "m1", value: { message: { content }, summarized: false } },
    ],
  });
  const request = {
    expectedGeneration: 1,
    operationId: "update",
    changes: [{ collection: "metadata", key: "name", value: "updated" }],
  };
  await source.commit(request);
  return { sessionDir, source, first, request, content };
}

for (const objectStore of [ImmutableObjectStore, ImmutableRecordStore, JsonLocatedFixture]) {
  test(`${objectStore.format} migrates to located records with history and retries intact`, async (t) => {
    const { sessionDir, source, request, content } = await fixture(t, objectStore);
    const before = await source.snapshot();
    if (objectStore === JsonLocatedFixture) {
      await assert.rejects(ImmutableSessionStore.open({ sessionDir }), {
        code: "SESSION_IMMUTABLE_STORAGE_INVALID",
      });
      const offline = new (immutableOfflineBackend(before.format))(sessionDir);
      assert.throws(() => offline.beginCommit(before), /read-only/);
    }
    await migrateImmutableSessionSegments({ sessionDir, targetFormat });
    const target = await ImmutableSessionStore.open({
      sessionDir,
      objectStore: ImmutableLocatedRecordStore,
    });
    const head = await target.snapshot();
    assert.equal(head.format, targetFormat);
    assert.equal(head.generation, before.generation);
    assert.equal((await target.get(head, "messages", "m1")).message.content, content);
    assert.equal((await target.commit(request)).replayed, true);
    const report = await auditImmutableSession({
      sessionDir,
      objectStore: ImmutableLocatedRecordStore,
    });
    assert.equal(report.ok, true, JSON.stringify(report.issues));
    assert.equal(report.checkedCommits, 2);
    const bytes = await readFile(target.headPath);
    await migrateImmutableSessionSegments({ sessionDir, targetFormat });
    assert.deepEqual(await readFile(target.headPath), bytes);
    await target.commit({
      expectedGeneration: 2,
      operationId: "after-migration",
      changes: [{ collection: "metadata", key: "name", value: "new" }],
    });
    assert.equal((await target.get(head, "messages", "m1")).message.content, content);
  });
}

for (const objectStore of [ImmutableRecordStore, JsonLocatedFixture, ImmutableLocatedRecordStore]) {
  for (const version of [2, 3]) {
    test(`${objectStore.format} v${version} wrapped commit index migrates with full history and retry receipts`, async (t) => {
      const { sessionDir, source, request, content } = await fixture(t, objectStore);
      await checkpointHistory(source);
      const legacy = await wrapLegacyCommitIndex(source, version);
      assert.deepEqual(
        await source.get(legacy, "checkpointCommits", "cp1"),
        version === 2 ? null : { kind: "commit", generation: 4 },
      );
      assert.equal((await source.get(legacy, "metadata", "commitIndex")).version, version);
      assert.equal(typeof (await source.get(legacy, "commitOrder", "0000000000000001")), "string");
      await assert.doesNotReject(
        migrateImmutableSessionSegments({ sessionDir, targetFormat }).catch((error) => {
          throw new Error(JSON.stringify(error.report ?? { message: error.message }), {
            cause: error,
          });
        }),
      );
      const target = await ImmutableSessionStore.open({ sessionDir });
      const head = await target.snapshot();
      assert.equal(head.generation, legacy.generation);
      assert.deepEqual(await target.get(head, "checkpointCommits", "cp1"), {
        kind: "commit",
        generation: 4,
      });
      assert.equal(await target.get(head, "checkpointCommits", "cp2"), null);
      assert.equal((await target.get(head, "checkpoints", "cp1")).requestHash, "hash-2");
      assert.equal((await target.get(head, "metadata", "commitIndex")).version, 4);
      assert.equal((await target.get(head, "messages", "m1")).message.content, content);
      assert.equal((await target.commit(request)).replayed, true);
      const report = await auditImmutableSession({ sessionDir });
      assert.equal(report.ok, true, JSON.stringify(report.issues));
      const bytes = await readFile(target.headPath);
      await migrateImmutableSessionSegments({ sessionDir, targetFormat });
      assert.deepEqual(await readFile(target.headPath), bytes);
      const reopened = await ImmutableSessionStore.open({ sessionDir });
      await reopened.commit({
        expectedGeneration: head.generation,
        operationId: "post-wrapped-migration",
        changes: [{ collection: "metadata", key: "name", value: "after" }],
      });
      assert.equal((await auditImmutableSession({ sessionDir })).ok, true);
      assert.equal((await reopened.commit(request)).replayed, true);
    });

    test(`${objectStore.format} v${version} wrapped index publication failure preserves source and retries`, async (t) => {
      const { sessionDir, source, request } = await fixture(t, objectStore);
      await checkpointHistory(source);
      const legacy = await wrapLegacyCommitIndex(source, version);
      const bytes = await readFile(source.headPath);
      const failure = new Error("wrapped migration publication failed");
      setFsAdapter({
        rename: async (from, to) => {
          if (to === source.headPath) throw failure;
          return rename(from, to);
        },
      });
      try {
        await assert.rejects(
          migrateImmutableSessionSegments({ sessionDir, targetFormat }),
          (error) => error === failure,
        );
      } finally {
        resetFsAdapter();
      }
      assert.deepEqual(await readFile(source.headPath), bytes);
      assert.equal((await source.get(legacy, "metadata", "commitIndex")).version, version);
      await migrateImmutableSessionSegments({ sessionDir, targetFormat });
      const target = await ImmutableSessionStore.open({ sessionDir });
      assert.equal((await auditImmutableSession({ sessionDir })).ok, true);
      assert.equal((await target.commit(request)).replayed, true);
    });
  }
}

test("located migration preserves scalar order indexes nested in turn records", async (t) => {
  const { sessionDir, source } = await fixture(t, ImmutableRecordStore);
  await source.transact({
    expectedGeneration: 2,
    operationId: "turn-order",
    input: {},
    prepare: async ({ snapshot }) => {
      const message = await source.index.get(
        await source.index.get(snapshot.root, "messages"),
        "m1",
      );
      const messagesRoot = await source.index.set(null, "m1", message);
      const messageOrderRoot = await source.index.set(
        null,
        "1",
        await source.objects.putValue("m1"),
      );
      return {
        changes: [
          {
            collection: "turns",
            key: "t1",
            value: { messagesRoot, messageOrderRoot, messageCount: 1 },
          },
        ],
      };
    },
  });
  await migrateImmutableSessionSegments({ sessionDir, targetFormat });
  const target = await ImmutableSessionStore.open({ sessionDir });
  const head = await target.snapshot();
  const turn = await target.get(head, "turns", "t1");
  await target.objects.withSnapshot(head, async () => {
    const reference = await target.index.get(turn.messageOrderRoot, "1");
    assert.equal(await target.objects.readValue(reference), "m1");
  });
  const report = await auditImmutableSession({
    sessionDir,
    objectStore: ImmutableLocatedRecordStore,
  });
  assert.equal(report.ok, true, JSON.stringify(report.issues));
});

test("located migration publication failure keeps source readable and retryable", async (t) => {
  const { sessionDir, source } = await fixture(t, ImmutableRecordStore);
  const bytes = await readFile(source.headPath);
  const failure = new Error("migration rename failed");
  setFsAdapter({
    rename: async (from, to) => {
      if (to === source.headPath) throw failure;
      return rename(from, to);
    },
  });
  try {
    await assert.rejects(
      migrateImmutableSessionSegments({ sessionDir, targetFormat }),
      (e) => e === failure,
    );
  } finally {
    resetFsAdapter();
  }
  assert.deepEqual(await readFile(source.headPath), bytes);
  assert.equal(
    (await auditImmutableSession({ sessionDir, objectStore: ImmutableRecordStore })).ok,
    true,
  );
  await migrateImmutableSessionSegments({ sessionDir, targetFormat });
  assert.equal(
    (await auditImmutableSession({ sessionDir, objectStore: ImmutableLocatedRecordStore })).ok,
    true,
  );
});

test("located migration refuses retained readers before changing authority", async (t) => {
  const { sessionDir, source } = await fixture(t, ImmutableRecordStore);
  const retention = await acquireImmutableReaderRetention(source, async () => {});
  const bytes = await readFile(source.headPath);
  try {
    await assert.rejects(migrateImmutableSessionSegments({ sessionDir, targetFormat }), {
      code: "SESSION_STORAGE_MIGRATION_READERS_ACTIVE",
    });
    assert.deepEqual(await readFile(source.headPath), bytes);
  } finally {
    await retention.release();
  }
});
