/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { ImmutableLocatedRecordStore } from "../../src/session/session-artifact-session/immutable-located-record-store.js";
import { auditImmutableSnapshot } from "../../src/session/session-artifact-session/immutable-session-audit.js";
import { restoreImmutableObjects } from "../../src/session/session-artifact-session/immutable-object-repair.js";
import { decodeImmutableRecordReference } from "@noobot/session-protocol/immutable-segment";
import { acquireImmutableReaderRetention } from "../../src/session/session-artifact-session/immutable-reader-retention.js";

test("located repair restores committed content without changing head or identity", async (t) => {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "located-repair-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const store = new ImmutableSessionStore({
    sessionDir,
    sessionId: "repair",
    allowCreate: true,
    objectStore: ImmutableLocatedRecordStore,
  });
  await store.commit({
    expectedGeneration: 0,
    operationId: "seed",
    changes: [{ collection: "metadata", key: "test", value: { text: "restore" } }],
  });
  const snapshot = await store.snapshot();
  const reference = snapshot.root;
  const bytes = await store.objects.withSnapshot(snapshot, () => store.objects.read(reference));
  const location = decodeImmutableRecordReference(
    await store.objects.locations.get(snapshot.locationRoot, reference),
  );
  const handle = await open(store.objects.segments.segmentPath(location.segmentId), "r+");
  try {
    await handle.write(Buffer.from([bytes[0] ^ 1]), 0, 1, location.offset);
    await handle.sync();
  } finally {
    await handle.close();
  }
  assert.equal((await auditImmutableSnapshot({ store, snapshot })).ok, false);
  const replacements = new Map([[reference, bytes]]);
  const preflight = await auditImmutableSnapshot({
    store,
    snapshot,
    objectOverrides: replacements,
  });
  assert.equal(preflight.ok, true, JSON.stringify(preflight.issues));
  await restoreImmutableObjects({
    sessionDir,
    objectStore: ImmutableLocatedRecordStore,
    replacements,
  });
  assert.deepEqual(await store.snapshot(), snapshot);
  assert.deepEqual(await store.get(snapshot, "metadata", "test"), { text: "restore" });
  assert.equal((await auditImmutableSnapshot({ store, snapshot })).ok, true);
});

test("missing locator evidence rejects repair before restoring any segment", async (t) => {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "located-repair-evidence-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "evidence", allowCreate: true });
  await store.commit({
    expectedGeneration: 0,
    operationId: "seed",
    changes: [{ collection: "metadata", key: "test", value: { text: "restore" } }],
  });
  const snapshot = await store.snapshot();
  const head = await readFile(store.headPath);
  const replacements = new Map();
  for await (const location of store.objects.physicalReferences(snapshot)) {
    const record = decodeImmutableRecordReference(location);
    replacements.set(record.digest, await store.objects.segments.read(location));
  }
  const locator = decodeImmutableRecordReference(snapshot.locationRoot);
  const file = store.objects.segments.segmentPath(locator.segmentId);
  const locatorBytes = replacements.get(locator.digest);
  replacements.delete(locator.digest);
  await rm(file);
  await assert.rejects(restoreImmutableObjects({ sessionDir, replacements }), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  await assert.rejects(readFile(file), { code: "ENOENT" });
  assert.deepEqual(await readFile(store.headPath), head);
  replacements.set(locator.digest, locatorBytes);
  await restoreImmutableObjects({ sessionDir, replacements });
  assert.deepEqual(await store.get(snapshot, "metadata", "test"), { text: "restore" });
  assert.deepEqual(await readFile(store.headPath), head);
});

test("repair restores an old reader's locator root independently of the current root", async (t) => {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "located-repair-reader-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "reader", allowCreate: true });
  await store.commit({
    expectedGeneration: 0,
    operationId: "seed",
    changes: [{ collection: "metadata", key: "test", value: { text: "old" } }],
  });
  const reader = await acquireImmutableReaderRetention(store, async () => {});
  await using retainedReader = { [Symbol.asyncDispose]: reader.release };
  assert.equal(retainedReader[Symbol.asyncDispose], reader.release);
  const old = reader.head;
  const location = decodeImmutableRecordReference(old.locationRoot);
  const bytes = await store.objects.segments.read(old.locationRoot);
  await store.commit({
    expectedGeneration: 1,
    operationId: "update",
    changes: [{ collection: "metadata", key: "test", value: { text: "new" } }],
  });
  const current = await store.snapshot();
  assert.notEqual(current.locationRoot, old.locationRoot);
  const head = await readFile(store.headPath);
  const handle = await open(store.objects.segments.segmentPath(location.segmentId), "r+");
  try {
    await handle.write(Buffer.from([bytes[0] ^ 1]), 0, 1, location.offset);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await assert.rejects(store.get(old, "metadata", "test"), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  assert.deepEqual(await store.get(current, "metadata", "test"), { text: "new" });
  await restoreImmutableObjects({ sessionDir, replacements: new Map([[location.digest, bytes]]) });
  assert.deepEqual(await store.get(old, "metadata", "test"), { text: "old" });
  assert.deepEqual(await store.get(current, "metadata", "test"), { text: "new" });
  assert.equal((await auditImmutableSnapshot({ store, snapshot: old })).ok, true);
  assert.deepEqual(await readFile(store.headPath), head);
});

test("repair yields on an unmatched locator page and preserves cancellation before restoration", async (t) => {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "located-repair-cancel-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "cancel", allowCreate: true });
  await store.commit({
    expectedGeneration: 0,
    operationId: "seed",
    changes: Array.from({ length: 200 }, (_, index) => ({
      collection: "metadata",
      key: `record-${index}`,
      value: index,
    })),
  });
  const snapshot = await store.snapshot();
  const head = await readFile(store.headPath);
  const segmentPath = store.objects.segments.segmentPath(snapshot.segmentTail.segmentId);
  const segment = await readFile(segmentPath);
  const controller = new AbortController();
  const reason = new Error("cancel before visiting unmatched locator children");
  const readPage = store.objects.locations.readPage.bind(store.objects.locations);
  let reads = 0;
  t.mock.method(store.objects.locations, "readPage", async (reference, prefix) => {
    reads += 1;
    const page = await readPage(reference, prefix);
    assert.equal(page.kind, "index-branch");
    setImmediate(() => controller.abort(reason));
    return page;
  });
  const replacements = new Map();
  await assert.rejects(
    store.objects.withPhysicalRepairOverlay(
      { replacements, used: new Set(), signal: controller.signal },
      () =>
        store.objects.restoreRecords(replacements, {
          signal: controller.signal,
          snapshots: [snapshot],
        }),
    ),
    (error) => error === reason,
  );
  assert.equal(reads, 1);
  assert.deepEqual(await readFile(store.headPath), head);
  assert.deepEqual(await readFile(segmentPath), segment);
});
