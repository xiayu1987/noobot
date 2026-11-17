/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { auditImmutableSession } from "../../src/session/session-artifact-session/immutable-session-audit.js";
import { repairSessionArtifacts } from "../../src/session/session-artifact-maintenance.js";
import { acquireImmutableReaderRetention } from "../../src/session/session-artifact-session/immutable-reader-retention.js";
import { prepareAndCleanupSessionArtifacts } from "../helpers/immutable-cleanup.js";
import { TEST_STORAGE_SERVICE as storageService } from "../helpers/storage-service.js";
import {
  collectValueRecords,
  corruptRecord,
  publishOrphanRecord,
  readCommittedRecord,
} from "./helpers/immutable-record-reads.js";

async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-content-maintenance-"));
  const retentions = [];
  t.after(async () => {
    try {
      for (const retention of retentions) await retention.release();
    } finally {
      await rm(sessionDir, { recursive: true, force: true });
    }
  });
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "content", allowCreate: true });
  const value = {
    ordinal: 1,
    turnOrdinal: 1,
    message: {
      messageUid: "m1",
      content: { text: "中文🙂".repeat(20000), opaqueHash: "f".repeat(64) },
      summarized: false,
    },
  };
  await store.commit({
    expectedGeneration: 0,
    operationId: "seed-content",
    changes: [{ collection: "messages", key: "m1", value }],
  });
  const snapshot = await store.snapshot();
  const { reference, descriptor } = await store.objects.withSnapshot(snapshot, async () => {
    const reference = await store.index.get(await store.index.get(snapshot.root, "messages"), "m1");
    return { reference, descriptor: await store.objects.readPage(reference) };
  });
  assert.equal(
    descriptor.kind,
    "value-parts-inline",
    "fixture must exercise independently stored content",
  );
  return { store, snapshot, reference, descriptor, value, retentions };
}

test("content references remain stable through metadata changes and retained-reader cleanup", async (t) => {
  const { store, snapshot, reference, descriptor, value, retentions } = await fixture(t);
  const retention = await acquireImmutableReaderRetention(store, async () => {});
  retentions.push(retention);
  const updated = { ...value, message: { ...value.message, summarized: true } };
  await store.commit({
    expectedGeneration: snapshot.generation,
    operationId: "mark-summarized",
    changes: [
      {
        collection: "messages",
        key: "m1",
        value: { ...updated, message: { ...updated.message, content: null } },
        parts: descriptor.parts,
      },
    ],
  });
  const current = await store.snapshot();
  const { nextReference, next } = await store.objects.withSnapshot(current, async () => {
    const nextReference = await store.index.get(
      await store.index.get(current.root, "messages"),
      "m1",
    );
    return { nextReference, next: await store.objects.readPage(nextReference) };
  });
  assert.notEqual(nextReference, reference);
  assert.equal(next.parts[0].reference, descriptor.parts[0].reference);
  const retained = await collectValueRecords(store, reference);
  const orphan = await publishOrphanRecord(store, Buffer.from("uncommitted orphan"));
  const maintenance = {
    storageService,
    sessionDir: store.sessionDir,
    assertSessionWritable: async () => {},
  };
  const cleanup = await prepareAndCleanupSessionArtifacts({ ...maintenance, dryRun: false });
  assert.ok(cleanup.removed.length > 0);
  await assert.rejects(store.objects.segments.read(orphan), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  for (const record of retained)
    await store.objects.withSnapshot(snapshot, () => store.objects.read(record));
  assert.deepEqual(await store.get(snapshot, "messages", "m1"), value);
  assert.deepEqual(await store.get(current, "messages", "m1"), updated);
  assert.equal((await auditImmutableSession({ sessionDir: store.sessionDir })).ok, true);
});

test("independent body corruption is audited and exact repair preserves the committed head", async (t) => {
  const { store, snapshot, descriptor, value } = await fixture(t);
  const bodyRecords = await collectValueRecords(store, descriptor.parts[0].reference);
  const reference = [...bodyRecords].at(-1);
  const bytes = await readCommittedRecord(store, reference);
  const head = await readFile(store.headPath);
  await corruptRecord(store, reference);
  const report = await auditImmutableSession({ sessionDir: store.sessionDir });
  assert.equal(report.ok, false);
  await assert.rejects(store.get(snapshot, "messages", "m1"), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  const repair = () =>
    repairSessionArtifacts({
      storageService,
      sessionDir: store.sessionDir,
      alreadyLocked: false,
      assertSessionWritable: async () => {},
      objectReplacements: [{ reference, bytes }],
    });
  const restored = await repair();
  assert.equal(restored.after.ok, true, JSON.stringify(restored.after));
  assert.equal(restored.repaired.length, 1);
  assert.deepEqual(await readFile(store.headPath), head);
  assert.deepEqual(await store.get(snapshot, "messages", "m1"), value);
  assert.deepEqual((await repair()).repaired, []);
});
