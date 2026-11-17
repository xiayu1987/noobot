/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readdir, readFile, writeFile, open, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  IMMUTABLE_READER_RETENTION as RETENTION,
  decodeImmutableCleanupRecord,
  encodeImmutableCleanupRecord,
  immutablePublicationTemporaryFile,
} from "@noobot/session-protocol/immutable-storage";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { openSessionArtifactReader } from "../../src/session/session-artifact-session/immutable-session-reader.js";
import { auditImmutableSession } from "../../src/session/session-artifact-session/immutable-session-audit.js";
import {
  prepareSessionArtifactCleanup,
  cleanupSessionArtifacts,
  discardSessionArtifactCleanup,
} from "../../src/session/session-artifact-maintenance.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { TEST_STORAGE_SERVICE as storageService } from "../helpers/storage-service.js";
import { committedPhysicalRecord } from "./helpers/immutable-record-reads.js";

async function abandonedPublication(sessionDir) {
  const file = immutablePublicationTemporaryFile(path.join(sessionDir, "head.json"), randomUUID());
  await writeFile(file, "orphan");
  return file;
}

async function fixture(t, sessionId = "retained") {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "reader-retention-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const store = new ImmutableSessionStore({ sessionDir, sessionId, allowCreate: true });
  const initial = {
    expectedGeneration: 0,
    operationId: "first",
    changes: [
      { collection: "metadata", key: "session", value: { sessionId, parentSessionId: "" } },
      { collection: "metadata", key: "facts", value: { messageCount: 1 } },
    ],
  };
  await store.commit(initial);
  const directory = path.join(sessionDir, RETENTION.directory);
  const options = { storageService, sessionDir, assertSessionWritable: async () => {} };
  const advance = () =>
    store.commit({
      expectedGeneration: 1,
      operationId: "second",
      changes: [{ collection: "metadata", key: "facts", value: { messageCount: 2 } }],
    });
  return { store, sessionDir, directory, options, initial, advance };
}

async function collect(options) {
  const plan = await prepareSessionArtifactCleanup({ ...options, dryRun: false });
  let result;
  do {
    result = await cleanupSessionArtifacts({ ...options, planId: plan.planId, maxCandidates: 1 });
  } while (!result.complete);
  await discardSessionArtifactCleanup({ ...options, planId: plan.planId });
  return result;
}

test("retention records are durable, independent and removed by concurrent close", async (t) => {
  const { sessionDir, directory, store, advance } = await fixture(t);
  const readers = await Promise.all(
    Array.from({ length: 4 }, () => openSessionArtifactReader({ sessionDir })),
  );
  t.after(() => Promise.all(readers.map((reader) => reader.close())));
  const records = await readdir(directory);
  assert.equal(records.length, 4);
  const head = await store.snapshot();
  for (const file of records) {
    const record = decodeImmutableCleanupRecord(await readFile(path.join(directory, file), "utf8"));
    assert.deepEqual(record.head, head);
    assert.equal(file, `${record.id}.json`);
  }
  await advance();
  for (const reader of readers) assert.deepEqual(await reader.readFacts(), { messageCount: 1 });
  await Promise.all(readers.flatMap((reader) => [reader.close(), reader.close()]));
  assert.deepEqual(await readdir(directory), []);
  await assert.rejects(readers[0].readFacts(), { code: "SESSION_READER_CLOSED" });
});

test("failed acquisition rolls back a published record; failed release can finish its directory sync", async (t) => {
  const { sessionDir, directory } = await fixture(t);
  const reader = await openSessionArtifactReader({ sessionDir });
  await reader.close();
  let fail = true;
  setFsAdapter({
    open: async (file, flags, ...args) => {
      const handle = await open(file, flags, ...args);
      if (String(file) === directory && flags === "r") {
        const sync = handle.sync.bind(handle);
        handle.sync = async () => {
          if (fail) {
            fail = false;
            throw new Error("retention sync failed");
          }
          return sync();
        };
      }
      return handle;
    },
  });
  t.after(resetFsAdapter);
  await assert.rejects(openSessionArtifactReader({ sessionDir }), /retention sync failed/);
  assert.deepEqual(await readdir(directory), []);
  const recovered = await openSessionArtifactReader({ sessionDir });
  fail = true;
  await assert.rejects(recovered.close(), /retention sync failed/);
  await assert.rejects(recovered.readFacts(), { code: "SESSION_READER_CLOSED" });
  await recovered.close();
  assert.deepEqual(await readdir(directory), []);
});

test("collection protects open historical readers and retires their index roots after close without losing replay", async (t) => {
  const { sessionDir, store, options, initial, advance } = await fixture(t);
  await using reader = await openSessionArtifactReader({ sessionDir });
  const historical = await store.snapshot();
  await advance();
  await collect(options);
  assert.deepEqual(await reader.readFacts(), { messageCount: 1 });
  const historicalRecord = await committedPhysicalRecord(store, historical.root);
  const segment = store.objects.segments.segmentPath(historicalRecord.segmentId);
  await access(segment);
  const pinned = new Set();
  assert.equal((await auditImmutableSession({ sessionDir, retainedObjects: pinned })).ok, true);
  assert.ok(pinned.has(historical.root));
  await reader.close();
  await collect(options);
  const retained = new Set();
  const audit = await auditImmutableSession({ sessionDir, retainedObjects: retained });
  assert.equal(audit.ok, true, JSON.stringify(audit));
  assert.equal(retained.has(historical.root), false);

  const retainedRecords = await Promise.all(
    [...retained].map((reference) => committedPhysicalRecord(store, reference)),
  );
  assert.ok(retainedRecords.some((record) => record.segmentId === historicalRecord.segmentId));
  await access(segment);
  assert.equal((await store.commit(initial)).replayed, true);
  await using current = await openSessionArtifactReader({ sessionDir });
  assert.deepEqual(await current.readFacts(), { messageCount: 2 });
  const changes = await current.readCommitChanges({ generation: 1, collections: ["metadata"] });
  assert.equal(changes.changes.find((change) => change.key === "facts").value.messageCount, 1);
});

test("a damaged retention record blocks preparation before deletion", async (t) => {
  const { sessionDir, directory, options, advance } = await fixture(t);
  await using reader = await openSessionArtifactReader({ sessionDir });
  assert.deepEqual(await reader.readFacts(), { messageCount: 1 });
  const [file] = await readdir(directory);
  await advance();
  const orphan = await abandonedPublication(sessionDir);
  await writeFile(path.join(directory, file), "broken");
  let planId;
  await assert.rejects(prepareSessionArtifactCleanup({ ...options, dryRun: false }), (error) => {
    assert.equal(error.code, "SESSION_MAINTENANCE_PREPARATION_INTERRUPTED");
    assert.equal(error.cause.code, "SESSION_IMMUTABLE_STORAGE_INVALID");
    planId = error.planId;
    return true;
  });
  await discardSessionArtifactCleanup({ ...options, planId });
  assert.equal(await readFile(orphan, "utf8"), "orphan");
});

test("acquisition rejects a retention envelope beyond the read limit before publishing it", async (t) => {
  const sample = await fixture(t);
  const sampleHead = await sample.store.snapshot();
  const overhead = Buffer.byteLength(
    encodeImmutableCleanupRecord({
      format: RETENTION.format,
      id: randomUUID(),
      head: { ...sampleHead, sessionId: "" },
    }),
  );
  const { sessionDir, directory, store } = await fixture(
    t,
    "x".repeat(RETENTION.recordBytes - overhead + 1),
  );
  assert.equal((await store.snapshot()).generation, 1);
  await assert.rejects(openSessionArtifactReader({ sessionDir }), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  await assert.rejects(access(directory), { code: "ENOENT" });
});

test("invalid UTF-8 retention bytes cannot pass a checksum after replacement decoding", async (t) => {
  const { sessionDir, directory, options } = await fixture(t, "retained-\ufffd");
  await using reader = await openSessionArtifactReader({ sessionDir });
  assert.deepEqual(await reader.readFacts(), { messageCount: 1 });
  const [file] = await readdir(directory);
  const target = path.join(directory, file);
  const bytes = await readFile(target);
  const offset = bytes.indexOf(Buffer.from("\ufffd"));
  assert.ok(offset >= 0);
  const damaged = Buffer.concat([
    bytes.subarray(0, offset),
    Buffer.from([0xff]),
    bytes.subarray(offset + 3),
  ]);
  assert.deepEqual(
    decodeImmutableCleanupRecord(damaged.toString("utf8")),
    decodeImmutableCleanupRecord(bytes.toString("utf8")),
  );
  const orphan = await abandonedPublication(sessionDir);
  await writeFile(target, damaged);
  let planId;
  await assert.rejects(prepareSessionArtifactCleanup({ ...options, dryRun: false }), (error) => {
    assert.equal(error.code, "SESSION_MAINTENANCE_PREPARATION_INTERRUPTED");
    assert.equal(error.cause.code, "SESSION_IMMUTABLE_STORAGE_INVALID");
    planId = error.planId;
    return true;
  });
  await discardSessionArtifactCleanup({ ...options, planId });
  assert.equal(await readFile(orphan, "utf8"), "orphan");
});
