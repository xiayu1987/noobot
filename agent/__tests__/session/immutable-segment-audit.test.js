/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, open, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { ImmutableRecordStore } from "../../src/session/session-artifact-session/immutable-record-store.js";
import {
  auditImmutableSession,
  auditImmutableSnapshot,
} from "../../src/session/session-artifact-session/immutable-session-audit.js";
import {
  acquireImmutableReaderRetention,
  readImmutableReaderRetentions,
} from "../../src/session/session-artifact-session/immutable-reader-retention.js";
import { decodeImmutableRecordReference } from "@noobot/session-protocol/immutable-segment";
import {
  IMMUTABLE_SESSION_FORMAT,
  requireImmutableRetainedSnapshot,
} from "@noobot/session-protocol/immutable-storage";

async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-segment-audit-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const store = new ImmutableSessionStore({
    sessionDir,
    sessionId: "segment-audit",
    allowCreate: true,
    objectStore: ImmutableRecordStore,
  });
  await store.commit({
    expectedGeneration: 0,
    operationId: "seed",
    changes: [
      ...Array.from({ length: 128 }, (_, index) => ({
        collection: "metadata",
        key: `item:${index}`,
        value: { index },
      })),
      {
        collection: "messages",
        key: "m1",
        value: { message: { content: "old message".repeat(10000) } },
      },
      { collection: "commands", key: "command", value: { status: "started" } },
    ],
  });
  return { store, sessionDir };
}

test("segment audit replays split indexes, command origins and explicitly retained old readers", async (t) => {
  const { store, sessionDir } = await fixture(t);
  const reader = await acquireImmutableReaderRetention(store, async () => {});
  try {
    await store.commit({
      expectedGeneration: 1,
      operationId: "update",
      changes: [
        { collection: "messages", key: "m1", value: { message: { content: "new" } } },
        { collection: "metadata", key: "item:0", remove: true },
        { collection: "commands", key: "command", value: { status: "finished" } },
      ],
    });
    const report = await auditImmutableSession({ sessionDir, objectStore: ImmutableRecordStore });
    assert.equal(report.ok, true, JSON.stringify(report.issues));
    assert.equal(report.checkedCommits, 2);
    assert.deepEqual(await readImmutableReaderRetentions(store, await store.snapshot()), [
      reader.head,
    ]);
    assert.equal(
      (await store.get(reader.head, "messages", "m1")).message.content,
      "old message".repeat(10000),
    );
  } finally {
    await reader.release();
  }
  assert.deepEqual(await readdir(path.join(sessionDir, "staging/readers")), []);
});

test("segment audit detects record corruption and validates repair bytes against location and digest", async (t) => {
  const { store } = await fixture(t);
  const snapshot = await store.snapshot();
  const reference = snapshot.root;
  const original = await store.objects.read(reference);
  const record = decodeImmutableRecordReference(reference);
  const handle = await open(store.objects.segments.segmentPath(record.segmentId), "r+");
  try {
    await handle.write(Buffer.from([original[0] ^ 1]), 0, 1, record.offset);
    await handle.sync();
  } finally {
    await handle.close();
  }
  assert.equal((await auditImmutableSnapshot({ store, snapshot })).ok, false);
  const repaired = await auditImmutableSnapshot({
    store,
    snapshot,
    objectOverrides: new Map([[reference, original]]),
  });
  assert.equal(repaired.ok, true, JSON.stringify(repaired.issues));
  const invalid = await auditImmutableSnapshot({
    store,
    snapshot,
    objectOverrides: new Map([[reference, Buffer.from("bad")]]),
  });
  assert.equal(invalid.ok, false);
  assert.match(invalid.issues[0].message, /identity/);
});

test("segment audit budgets include physical record reads without leaking scope into the source", async (t) => {
  const { store } = await fixture(t);
  const snapshot = await store.snapshot();
  const limited = await auditImmutableSnapshot({ store, snapshot, maxObjectReads: 1 });
  assert.equal(limited.ok, false);
  assert.equal(limited.objectReads, 1);
  assert.equal(limited.issues[0].code, "SESSION_MAINTENANCE_BUDGET_EXCEEDED");
  assert.deepEqual(await store.get(snapshot, "metadata", "item:0"), { index: 0 });
  assert.equal((await auditImmutableSnapshot({ store, snapshot })).ok, true);
});

test("retained readers reject a different storage format even for the same session and generation", async (t) => {
  const { store } = await fixture(t);
  const head = await store.snapshot();
  const other = {
    ...head,
    format: IMMUTABLE_SESSION_FORMAT,
    root: "a".repeat(64),
    operations: "b".repeat(64),
    commit: "c".repeat(64),
  };
  assert.throws(() => requireImmutableRetainedSnapshot(other, head), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  assert.throws(() => requireImmutableRetainedSnapshot(head, other), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
});
