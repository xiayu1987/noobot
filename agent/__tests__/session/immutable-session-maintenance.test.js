/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { auditImmutableSession } from "../../src/session/session-artifact-session/immutable-session-audit.js";
import {
  inspectSessionArtifacts,
  repairSessionArtifacts,
} from "../../src/session/session-artifact-maintenance.js";
import { prepareAndCleanupSessionArtifacts as cleanupSessionArtifacts } from "../helpers/immutable-cleanup.js";
import { TEST_STORAGE_SERVICE as storageService } from "../helpers/storage-service.js";
import { acquireImmutableReaderRetention } from "../../src/session/session-artifact-session/immutable-reader-retention.js";
import { decodeImmutableRecordReference } from "@noobot/session-protocol/immutable-segment";
import {
  corruptRecord,
  committedPhysicalRecord,
  readCommittedRecord,
} from "./helpers/immutable-record-reads.js";

async function segmentPath(store, reference) {
  return store.objects.segments.segmentPath(
    (await committedPhysicalRecord(store, reference)).segmentId,
  );
}

async function publishOrphan(store, value) {
  const bytes = Buffer.from(JSON.stringify(value));
  const batch = store.objects.segments.createBatch();
  try {
    const location = batch.stage(bytes);
    await batch.publish([location]);
    const record = decodeImmutableRecordReference(location);
    return {
      reference: record.digest,
      bytes,
      file: store.objects.segments.segmentPath(record.segmentId),
    };
  } finally {
    batch.release();
  }
}

async function fixture(context) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-maintenance-"));
  let retention = null;
  context.after(async () => {
    try {
      await retention?.release();
    } finally {
      await rm(sessionDir, { recursive: true, force: true });
    }
  });
  const store = new ImmutableSessionStore({
    sessionDir,
    sessionId: "session-1",
    allowCreate: true,
  });
  const value = { content: "中文🙂".repeat(20000), opaqueHash: "f".repeat(64) };
  await store.commit({
    expectedGeneration: 0,
    operationId: "first",
    changes: [{ collection: "messages", key: "message-1", value }],
  });
  const snapshot = await store.snapshot();
  retention = await acquireImmutableReaderRetention(store, async () => {});
  const { reference, bytes } = await store.objects.withSnapshot(snapshot, async () => {
    const root = await store.index.get(snapshot.root, "messages");
    const reference = await store.index.get(root, "message-1");
    return { reference, bytes: await store.objects.read(reference) };
  });
  await cleanupSessionArtifacts({
    storageService,
    sessionDir,
    dryRun: false,
    assertSessionWritable: async () => {},
  });
  return { store, sessionDir, snapshot, reference, bytes, value };
}
function repair(sessionDir, objectReplacements) {
  return repairSessionArtifacts({
    storageService,
    sessionDir,
    alreadyLocked: false,
    assertSessionWritable: async () => {},
    objectReplacements,
  });
}

test("audit verifies multi-block values and historical commits without treating content hashes as references", async (context) => {
  const { store, sessionDir, snapshot, reference, value } = await fixture(context);
  await store.commit({
    expectedGeneration: 1,
    operationId: "remove",
    changes: [{ collection: "messages", key: "message-1", remove: true }],
  });
  const healthy = await auditImmutableSession({ sessionDir, batchSize: 1 });
  assert.equal(healthy.ok, true, JSON.stringify(healthy));
  assert.equal(healthy.checkedCommits, 2);
  assert.deepEqual(await store.get(snapshot, "messages", "message-1"), value);
  await corruptRecord(store, reference);
  const broken = await auditImmutableSession({ sessionDir });
  assert.equal(broken.ok, false);
  assert.equal(broken.complete, false);
  assert.equal(broken.issues[0].location.reference, reference);
});

test("exact-byte repair preserves the head and pinned snapshot; retry is idempotent", async (context) => {
  const { store, sessionDir, snapshot, reference, bytes, value } = await fixture(context);
  await store.commit({
    expectedGeneration: 1,
    operationId: "replace",
    changes: [{ collection: "messages", key: "message-1", value: "new" }],
  });
  const head = await readFile(store.headPath);
  await corruptRecord(store, reference);
  const damaged = await readFile(await segmentPath(store, reference));
  const inspected = await inspectSessionArtifacts({ storageService, sessionDir });
  assert.equal(inspected.ok, false);
  assert.deepEqual(await readFile(await segmentPath(store, reference)), damaged);
  const replacements = [{ reference, bytes }];
  const restored = await repair(sessionDir, replacements);
  assert.equal(restored.before.ok, false);
  assert.equal(restored.after.ok, true, JSON.stringify(restored.after));
  assert.equal(restored.repaired.length, 1);
  assert.deepEqual(await readFile(store.headPath), head);
  assert.deepEqual(await store.get(snapshot, "messages", "message-1"), value);
  assert.deepEqual((await repair(sessionDir, replacements)).repaired, []);
});

test("repair rejects wrong, unreferenced and insufficient evidence before writing", async (context) => {
  const { store, sessionDir, snapshot, reference, bytes } = await fixture(context);
  const commitBytes = await readCommittedRecord(store, snapshot.commit);
  await corruptRecord(store, reference);
  await corruptRecord(store, snapshot.commit);
  const damaged = await readFile(await segmentPath(store, reference));
  await assert.rejects(repair(sessionDir, [{ reference, bytes: Buffer.from("wrong") }]), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  await assert.rejects(repair(sessionDir, [{ reference, bytes }]), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  assert.deepEqual(await readFile(await segmentPath(store, reference)), damaged);
  const unrelated = await publishOrphan(store, "uncommitted");
  await assert.rejects(
    repair(sessionDir, [
      { reference, bytes },
      { reference: snapshot.commit, bytes: commitBytes },
      { reference: unrelated.reference, bytes: unrelated.bytes },
    ]),
    { code: "SESSION_IMMUTABLE_STORAGE_INVALID" },
  );
  assert.deepEqual(await readFile(await segmentPath(store, reference)), damaged);
  assert.equal(
    (
      await repair(sessionDir, [
        { reference, bytes },
        { reference: snapshot.commit, bytes: commitBytes },
      ])
    ).after.ok,
    true,
  );
});

test("nested message indexes are part of the verified graph", async (context) => {
  const { store, sessionDir } = await fixture(context);
  let nested;
  await store.transact({
    expectedGeneration: 1,
    operationId: "turn",
    input: {},
    prepare: async () => {
      nested = await store.objects.putValue({ content: "nested" });
      const nestedRoot = await store.index.set(null, "nested-message", nested);
      const orderValue = await store.objects.putValue("nested-message");
      const orderRoot = await store.index.set(null, "1", orderValue);
      return {
        changes: [
          {
            collection: "turns",
            key: "turn-1",
            value: { messagesRoot: nestedRoot, messageOrderRoot: orderRoot, messageCount: 1 },
          },
        ],
      };
    },
  });
  assert.equal((await auditImmutableSession({ sessionDir })).ok, true);
  await corruptRecord(store, nested);
  assert.equal((await auditImmutableSession({ sessionDir })).ok, false);
});

test("cleanup removes only owned publication leftovers and preserves old snapshot objects", async (context) => {
  const { store, sessionDir, snapshot, value } = await fixture(context);
  await store.commit({
    expectedGeneration: 1,
    operationId: "remove",
    changes: [{ collection: "messages", key: "message-1", remove: true }],
  });
  const temporary = path.join(sessionDir, "head.json.aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.tmp");
  const legacy = path.join(sessionDir, "session.json");
  const unrelated = path.join(sessionDir, "write.tmp-1");
  await writeFile(temporary, "partial");
  await writeFile(legacy, "{}");
  await writeFile(unrelated, "unrelated");
  const options = { storageService, sessionDir, assertSessionWritable: async () => {} };
  const preview = await cleanupSessionArtifacts({ ...options, dryRun: true });
  assert.ok(preview.removed.includes(temporary));
  await access(temporary);
  assert.deepEqual(
    (await cleanupSessionArtifacts({ ...options, dryRun: false })).removed,
    preview.removed,
  );
  await assert.rejects(access(temporary), { code: "ENOENT" });
  await access(legacy);
  await access(unrelated);
  assert.deepEqual(await store.get(snapshot, "messages", "message-1"), value);
});

test("cleanup reclaims aborted objects in bounded batches without expiring historical readers or retries", async (context) => {
  const { store, sessionDir, snapshot, value } = await fixture(context);
  const changes = [{ collection: "messages", key: "message-1", value: "replacement" }];
  const committed = await store.commit({
    expectedGeneration: 1,
    operationId: "replacement",
    changes,
  });
  const later = await store.snapshot();
  await assert.rejects(
    store.transact({
      expectedGeneration: 2,
      operationId: "aborted",
      input: {},
      prepare: async () => {
        await store.objects.putValue({ aborted: "never published" });
        throw new Error("preparation failed");
      },
    }),
    /preparation failed/,
  );
  const orphan = await publishOrphan(store, { orphan: "not a business record" });
  await publishOrphan(store, { orphan: "another detached segment" });
  const options = {
    storageService,
    sessionDir,
    assertSessionWritable: async () => {},
    maxRemovals: 1,
  };
  const dry = await cleanupSessionArtifacts({ ...options, dryRun: true });
  assert.equal(dry.removed.length, 1);
  assert.equal(dry.limitReached, true);
  await access(dry.removed[0]);
  let removed = 0;
  for (let batch = 0; batch < dry.candidates; batch += 1) {
    const result = await cleanupSessionArtifacts({ ...options, dryRun: false });
    assert.ok(result.removed.length <= 1);
    removed += result.removed.length;
    if (!result.limitReached) break;
  }
  assert.equal(removed, dry.candidates);
  await assert.rejects(access(orphan.file), { code: "ENOENT" });
  const reopened = await ImmutableSessionStore.open({ sessionDir });
  assert.deepEqual(await reopened.get(snapshot, "messages", "message-1"), value);
  assert.equal(await reopened.get(later, "messages", "message-1"), "replacement");
  const replayed = await reopened.commit({
    expectedGeneration: 1,
    operationId: "replacement",
    changes,
  });
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.commit, committed.commit);
  assert.equal((await reopened.snapshot()).generation, 2);
  assert.equal((await auditImmutableSession({ sessionDir })).ok, true);
});

test("cleanup retains damaged historical records while audit reports corruption", async (context) => {
  const { store, sessionDir, snapshot } = await fixture(context);
  await store.commit({
    expectedGeneration: 1,
    operationId: "new",
    changes: [{ collection: "messages", key: "message-1", value: "new" }],
  });
  const orphan = await publishOrphan(store, "unpublished");
  await corruptRecord(store, snapshot.root);
  assert.equal((await auditImmutableSession({ sessionDir })).ok, false);
  const result = await cleanupSessionArtifacts({
    storageService,
    sessionDir,
    dryRun: false,
    assertSessionWritable: async () => {},
  });
  assert.equal(result.complete, true);
  assert.ok(result.removed.includes(orphan.file));
  await access(await segmentPath(store, snapshot.root));
  assert.equal((await auditImmutableSession({ sessionDir })).ok, false);
});

test("cleanup rejects invalid limits and propagates cancellation before deletion", async (context) => {
  const { store, sessionDir } = await fixture(context);
  const orphan = await publishOrphan(store, "keep on cancellation");
  const options = {
    storageService,
    sessionDir,
    dryRun: false,
    assertSessionWritable: async () => {},
  };
  for (const maxRemovals of [0, -1, 4097, 1.5])
    await assert.rejects(cleanupSessionArtifacts({ ...options, maxRemovals }), TypeError);
  const controller = new AbortController();
  controller.abort(new Error("maintenance cancelled"));
  await assert.rejects(
    cleanupSessionArtifacts({ ...options, signal: controller.signal }),
    /maintenance cancelled/,
  );
  await access(orphan.file);
});

test("explicit audit read exhaustion reports the exact budget without deleting objects", async (context) => {
  const { store, sessionDir } = await fixture(context);
  const orphan = await publishOrphan(store, "keep when verification is incomplete");
  const report = await auditImmutableSession({ sessionDir, maxObjectReads: 1 });
  assert.equal(report.ok, false);
  assert.equal(report.objectReads, 1);
  assert.equal(report.issues[0].code, "SESSION_MAINTENANCE_BUDGET_EXCEEDED");
  await access(orphan.file);
});

test("cleanup execution scans no directories, preserves foreign names and validates candidate limits", async (context) => {
  const { store, sessionDir, snapshot, value } = await fixture(context);
  const options = {
    storageService,
    sessionDir,
    dryRun: false,
    assertSessionWritable: async () => {},
  };
  const foreign = path.join(sessionDir, "segments", "not-a-segment");
  await writeFile(foreign, "keep");
  const report = await cleanupSessionArtifacts({ ...options, maxCandidates: 1 });
  assert.equal(report.limitReached, false);
  assert.equal(report.removed.length, 0);
  assert.deepEqual(await store.get(snapshot, "messages", "message-1"), value);
  assert.equal(await readFile(foreign, "utf8"), "keep");
  for (const key of ["maxCandidates"])
    for (const limit of [0, -1, 1000001, 1.5, null])
      await assert.rejects(cleanupSessionArtifacts({ ...options, [key]: limit }), TypeError);
});

test("legacy manifest cannot replace a missing authority; aborted audits propagate cancellation", async (context) => {
  const { store, sessionDir } = await fixture(context);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(auditImmutableSession({ sessionDir, signal: controller.signal }), {
    name: "AbortError",
  });
  await rm(store.headPath);
  await writeFile(
    path.join(sessionDir, "session.json"),
    JSON.stringify({ sessionId: "session-1" }),
  );
  assert.equal((await inspectSessionArtifacts({ storageService, sessionDir })).ok, false);
  await assert.rejects(repair(sessionDir, []), { code: "SESSION_IMMUTABLE_STORAGE_INVALID" });
});
