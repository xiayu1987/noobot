/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readdir, readFile, writeFile, open, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  IMMUTABLE_READER_RETENTION as RETENTION,
  encodeImmutableReaderRetention,
  requireImmutableReaderRecoveryRequest,
} from "@noobot/session-protocol/immutable-storage";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { ImmutableObjectStore } from "../../src/session/session-artifact-session/immutable-object-store.js";
import { ImmutableRecordStore } from "../../src/session/session-artifact-session/immutable-record-store.js";
import { migrateImmutableSessionSegments } from "../../src/session/session-artifact-session/immutable-segment-migration.js";
import { acquireImmutableReaderRetention } from "../../src/session/session-artifact-session/immutable-reader-retention.js";
import { auditImmutableSession } from "../../src/session/session-artifact-session/immutable-session-audit.js";
import {
  inspectSessionArtifactReader,
  recoverSessionArtifactReader,
} from "../../src/session/session-artifact-maintenance.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { TEST_STORAGE_SERVICE as storageService } from "../helpers/storage-service.js";

async function fixture(t, objectStore) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "reader-recovery-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const store = new ImmutableSessionStore({
    sessionDir,
    sessionId: "recovery",
    allowCreate: true,
    objectStore,
  });
  await store.commit({
    expectedGeneration: 0,
    operationId: "first",
    changes: [{ collection: "metadata", key: "test", value: 1 }],
  });

  await acquireImmutableReaderRetention(store, async () => {});
  const directory = path.join(sessionDir, RETENTION.directory);
  const [name] = await readdir(directory);
  const readerId = name.slice(0, -5);
  const file = path.join(directory, name);
  const inspection = { storageService, sessionDir, readerId, format: store.format };
  const inspected = await inspectSessionArtifactReader(inspection);
  const recovery = {
    ...inspection,
    expectedRecordDigest: inspected.recordDigest,
    assertSessionWritable: async () => {},
    assertReadersStopped: async () => {},
  };
  return { store, sessionDir, directory, file, inspection, inspected, recovery };
}

test("explicit recovery releases only the inspected abandoned root and remains idempotent", async (t) => {
  const f = await fixture(t);
  await f.store.commit({
    expectedGeneration: 1,
    operationId: "second",
    changes: [{ collection: "metadata", key: "test", value: 2 }],
  });
  const active = await acquireImmutableReaderRetention(f.store, async () => {});
  const retained = new Set();
  assert.equal(
    (await auditImmutableSession({ sessionDir: f.sessionDir, retainedObjects: retained })).ok,
    true,
  );
  assert.ok(retained.has(f.inspected.head.root));
  const head = await readFile(f.store.headPath);
  assert.deepEqual(await recoverSessionArtifactReader(f.recovery), {
    readerId: f.inspected.readerId,
    released: true,
  });
  assert.deepEqual(await readFile(f.store.headPath), head);
  assert.equal((await readdir(f.directory)).length, 1);
  const after = new Set();
  assert.equal(
    (await auditImmutableSession({ sessionDir: f.sessionDir, retainedObjects: after })).ok,
    true,
  );
  assert.equal(after.has(f.inspected.head.root), false);
  assert.equal((await recoverSessionArtifactReader(f.recovery)).released, false);
  await active.release();
});

test("writability, reader quiescence, inspected identity and cancellation all reject before release", async (t) => {
  const f = await fixture(t);
  const before = await readFile(f.file);
  const refused = async () => {
    throw new Error("owner refused");
  };
  for (const field of ["assertSessionWritable", "assertReadersStopped"])
    await assert.rejects(
      recoverSessionArtifactReader({ ...f.recovery, [field]: refused }),
      /owner refused/,
    );
  await assert.rejects(
    recoverSessionArtifactReader({ ...f.recovery, expectedRecordDigest: "0".repeat(64) }),
    {
      code: "SESSION_READER_RETENTION_CHANGED",
    },
  );
  const controller = new AbortController();
  controller.abort(new Error("cancel recovery"));
  await assert.rejects(
    recoverSessionArtifactReader({ ...f.recovery, signal: controller.signal }),
    /cancel recovery/,
  );
  assert.deepEqual(await readFile(f.file), before);
});

test("recovery rechecks record bytes after inspection and refuses foreign retained heads", async (t) => {
  const f = await fixture(t);
  await f.store.commit({
    expectedGeneration: 1,
    operationId: "second",
    changes: [{ collection: "metadata", key: "test", value: 2 }],
  });
  const record = {
    format: RETENTION.format,
    id: f.inspected.readerId,
    head: await f.store.snapshot(),
  };
  await writeFile(f.file, encodeImmutableReaderRetention(record, record.id, f.store.format));
  await assert.rejects(recoverSessionArtifactReader(f.recovery), {
    code: "SESSION_READER_RETENTION_CHANGED",
  });
  record.head.sessionId = "foreign";
  const bytes = encodeImmutableReaderRetention(record, record.id, f.store.format);
  await writeFile(f.file, bytes);
  await assert.rejects(inspectSessionArtifactReader(f.inspection), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  await assert.rejects(recoverSessionArtifactReader(f.recovery), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  assert.equal(await readFile(f.file, "utf8"), bytes);
});

test("recovery retry completes directory durability after unlink succeeded but sync failed", async (t) => {
  const f = await fixture(t);
  let syncs = 0;
  setFsAdapter({
    open: async (file, flags, ...args) => {
      const handle = await open(file, flags, ...args);
      if (String(file) === f.directory && flags === "r") {
        const sync = handle.sync.bind(handle);
        handle.sync = async () => {
          syncs += 1;
          if (syncs === 1) throw new Error("recovery sync failed");
          return sync();
        };
      }
      return handle;
    },
  });
  t.after(resetFsAdapter);
  await assert.rejects(recoverSessionArtifactReader(f.recovery), /recovery sync failed/);
  assert.deepEqual(await readdir(f.directory), []);
  assert.equal((await recoverSessionArtifactReader(f.recovery)).released, false);
  assert.equal(syncs, 2);
});

test("recovery refuses corrupt records and symlinks without removing their evidence", async (t) => {
  const f = await fixture(t);
  await writeFile(f.file, "damaged");
  await assert.rejects(recoverSessionArtifactReader(f.recovery), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  assert.equal(await readFile(f.file, "utf8"), "damaged");
  await rm(f.file);
  await symlink(f.store.headPath, f.file);
  await assert.rejects(inspectSessionArtifactReader(f.inspection), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  await assert.rejects(recoverSessionArtifactReader(f.recovery), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
});

for (const backend of [ImmutableObjectStore, ImmutableRecordStore]) {
  test(`explicit ${backend.format} recovery unblocks offline migration without reopening a legacy runtime path`, async (t) => {
    const f = await fixture(t, backend);
    const head = await readFile(f.store.headPath);
    const retained = await readFile(f.file);
    await assert.rejects(ImmutableSessionStore.open({ sessionDir: f.sessionDir }), {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    });
    await assert.rejects(migrateImmutableSessionSegments({ sessionDir: f.sessionDir }), {
      code: "SESSION_STORAGE_MIGRATION_READERS_ACTIVE",
    });
    assert.deepEqual(await readFile(f.store.headPath), head);
    assert.deepEqual(await readFile(f.file), retained);
    assert.equal((await recoverSessionArtifactReader(f.recovery)).released, true);
    assert.deepEqual(await readFile(f.store.headPath), head);
    await migrateImmutableSessionSegments({ sessionDir: f.sessionDir });
    const migrated = await ImmutableSessionStore.open({ sessionDir: f.sessionDir });
    assert.equal(await migrated.get(await migrated.snapshot(), "metadata", "test"), 1);
    await assert.rejects(inspectSessionArtifactReader(f.inspection), {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    });
  });
}

test("recovery rejects a declared format mismatch before releasing any reader", async (t) => {
  const f = await fixture(t);
  const before = await readFile(f.file);
  const wrong = { format: ImmutableObjectStore.format };
  await assert.rejects(inspectSessionArtifactReader({ ...f.inspection, ...wrong }), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  await assert.rejects(recoverSessionArtifactReader({ ...f.recovery, ...wrong }), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  assert.deepEqual(await readFile(f.file), before);
});

test("reader recovery has one exact request contract without expiry or PID inference", async (t) => {
  const f = await fixture(t);
  for (const phase of ["inspect", "recover"]) {
    const request = phase === "inspect" ? f.inspection : f.recovery;
    assert.equal(requireImmutableReaderRecoveryRequest(phase, request), request);
    for (const format of [undefined, null, "unknown-format"])
      assert.throws(() => requireImmutableReaderRecoveryRequest(phase, { ...request, format }), {
        code: "SESSION_IMMUTABLE_STORAGE_INVALID",
      });
    for (const extra of [{ force: true }, { pid: 1 }, { maxAgeMs: 0 }])
      assert.throws(
        () => requireImmutableReaderRecoveryRequest(phase, { ...request, ...extra }),
        TypeError,
      );
    assert.throws(() =>
      requireImmutableReaderRecoveryRequest(phase, { ...request, readerId: "../reader" }),
    );
  }
  for (const assertion of [undefined, null, true])
    assert.throws(
      () =>
        requireImmutableReaderRecoveryRequest("recover", {
          ...f.recovery,
          assertReadersStopped: assertion,
        }),
      TypeError,
    );
  assert.throws(() =>
    requireImmutableReaderRecoveryRequest("recover", {
      ...f.recovery,
      expectedRecordDigest: "invalid",
    }),
  );
});
