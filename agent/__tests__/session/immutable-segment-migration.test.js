/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, rename, open, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { CurrentImmutableRecordStore } from "../../src/session/session-artifact-session/immutable-storage-backends.js";
import { ImmutableObjectStore } from "../../src/session/session-artifact-session/immutable-object-store.js";
import { migrateImmutableSessionSegments } from "../../src/session/session-artifact-session/immutable-segment-migration.js";
import { auditImmutableSession } from "../../src/session/session-artifact-session/immutable-session-audit.js";
import { acquireImmutableReaderRetention } from "../../src/session/session-artifact-session/immutable-reader-retention.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { IMMUTABLE_VALUE_BLOCK_BYTES as BLOCK_BYTES } from "@noobot/session-protocol/immutable-storage-graph";
import { forbidRecordReads, collectValueRecords } from "./helpers/immutable-record-reads.js";

async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "segment-migration-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const source = new ImmutableSessionStore({
    sessionDir,
    sessionId: "migrate",
    allowCreate: true,
    objectStore: ImmutableObjectStore,
  });
  const changes = [
    ...Array.from({ length: 100 }, (_, i) => ({
      collection: "metadata",
      key: `item:${i}`,
      value: { content: "a".repeat(64), index: i },
    })),
    {
      collection: "messages",
      key: "m1",
      value: { message: { content: "unchanged body".repeat(30000) }, summarized: false },
    },
  ];
  await source.commit({ expectedGeneration: 0, operationId: "seed", changes });
  const request = {
    expectedGeneration: 1,
    operationId: "update",
    changes: [
      { collection: "metadata", key: "item:0", value: { content: "b".repeat(64), index: 0 } },
    ],
  };
  await source.commit(request);
  return { source, sessionDir, request };
}

test("segment migration preserves history, opaque bodies, cold reads and operation retry", async (t) => {
  const { source, sessionDir, request } = await fixture(t);
  const before = await source.snapshot();
  const message = await source.get(before, "messages", "m1");
  await migrateImmutableSessionSegments({ sessionDir });
  const target = await ImmutableSessionStore.open({
    sessionDir,
    objectStore: CurrentImmutableRecordStore,
  });
  const head = await target.snapshot();
  assert.equal(head.generation, before.generation);
  assert.equal((await target.commit(request)).replayed, true);
  assert.deepEqual(await target.get(head, "messages", "m1"), message);
  assert.deepEqual(await target.get(head, "metadata", "item:3"), {
    content: "a".repeat(64),
    index: 3,
  });
  const audit = await auditImmutableSession({
    sessionDir,
    objectStore: CurrentImmutableRecordStore,
  });
  assert.equal(audit.ok, true, JSON.stringify(audit.issues));
  assert.equal(audit.checkedCommits, 2);
  assert.ok((await readdir(path.join(sessionDir, "segments"))).length < 10);
  await assert.rejects(readdir(path.join(sessionDir, "objects")), { code: "ENOENT" });
  const committed = await readFile(target.headPath);
  await migrateImmutableSessionSegments({ sessionDir });
  assert.deepEqual(await readFile(target.headPath), committed);
  await assert.rejects(source.snapshot(), { code: "SESSION_IMMUTABLE_STORAGE_INVALID" });
});

test("completed migration does not audit history or invalidate active readers", async (t) => {
  const { sessionDir } = await fixture(t);
  await migrateImmutableSessionSegments({ sessionDir });
  const store = await ImmutableSessionStore.open({ sessionDir });
  const retention = await acquireImmutableReaderRetention(store, async () => {});
  const committed = await readFile(store.headPath);
  const snapshot = await store.snapshot();
  const forbidden = await store.objects.withSnapshot(snapshot, async () => {
    const records = new Set();
    let commit = snapshot.commit;
    for (let generation = snapshot.generation; generation > 0; generation -= 1) {
      const record = await store.readCommitRecord(commit, generation);
      await collectValueRecords(store, commit, records);
      commit = record.previous;
    }
    const messages = await store.index.get(snapshot.root, "messages");
    await collectValueRecords(store, await store.index.get(messages, "m1"), records);
    return [...records];
  });
  setFsAdapter(await forbidRecordReads(store, forbidden));
  try {
    await migrateImmutableSessionSegments({ sessionDir });
    assert.deepEqual(await readFile(store.headPath), committed);
  } finally {
    resetFsAdapter();
    await retention.release();
  }
});

test("migration requires explicit reader release and leaves the old head authoritative", async (t) => {
  const { source, sessionDir } = await fixture(t);
  const retention = await acquireImmutableReaderRetention(source, async () => {});
  const before = await readFile(source.headPath);
  try {
    await assert.rejects(migrateImmutableSessionSegments({ sessionDir }), {
      code: "SESSION_STORAGE_MIGRATION_READERS_ACTIVE",
    });
    assert.deepEqual(await readFile(source.headPath), before);
  } finally {
    await retention.release();
  }
  await migrateImmutableSessionSegments({ sessionDir });
});

test("head publication failure leaves the complete old graph available for migration retry", async (t) => {
  const { source, sessionDir } = await fixture(t);
  const before = await readFile(source.headPath);
  const failure = new Error("migration head publication failed");
  setFsAdapter({
    rename: async (from, to) => {
      if (to === source.headPath) throw failure;
      return rename(from, to);
    },
  });
  try {
    await assert.rejects(
      migrateImmutableSessionSegments({ sessionDir }),
      (error) => error === failure,
    );
  } finally {
    resetFsAdapter();
  }
  assert.deepEqual(await readFile(source.headPath), before);
  const audit = await auditImmutableSession({ sessionDir, objectStore: ImmutableObjectStore });
  assert.equal(audit.ok, true, JSON.stringify(audit.issues));
  await migrateImmutableSessionSegments({ sessionDir });
  assert.equal(
    (await auditImmutableSession({ sessionDir, objectStore: CurrentImmutableRecordStore })).ok,
    true,
  );
});

test("migration audits and translates persisted balanced content into stable blocks", async (t) => {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "balanced-content-migration-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const source = new ImmutableSessionStore({
    sessionDir,
    sessionId: "balanced",
    allowCreate: true,
    objectStore: ImmutableObjectStore,
  });
  const content = "中🙂".repeat(30000);
  const bytes = Buffer.from(JSON.stringify(content));
  const build = async (chunk) => {
    if (chunk.length <= BLOCK_BYTES)
      return source.objects.putPage({
        kind: "value",
        data: await source.objects.put(chunk),
        bytes: chunk.length,
      });
    const middle = Math.floor(chunk.length / 2);
    return source.objects.putPage({
      kind: "value-branch",
      left: await build(chunk.subarray(0, middle)),
      right: await build(chunk.subarray(middle)),
      bytes: chunk.length,
    });
  };
  await source.transact({
    expectedGeneration: 0,
    operationId: "seed-balanced",
    input: null,
    prepare: async () => ({
      changes: [
        {
          collection: "messages",
          key: "m1",
          value: { message: { content: null } },
          parts: [{ path: ["message", "content"], reference: await build(bytes) }],
        },
      ],
    }),
  });
  assert.equal(
    (await auditImmutableSession({ sessionDir, objectStore: ImmutableObjectStore })).ok,
    true,
  );
  await migrateImmutableSessionSegments({ sessionDir });
  const target = await ImmutableSessionStore.open({ sessionDir });
  const head = await target.snapshot();
  assert.deepEqual(await target.get(head, "messages", "m1"), { message: { content } });
  const { parts } = await target.objects.withSnapshot(head, async () => {
    const reference = await target.index.get(await target.index.get(head.root, "messages"), "m1");
    return target.objects.readValueMetadata(reference);
  });
  const sizes = [];
  const visit = async (candidate) => {
    const page = await target.objects.withSnapshot(head, () => target.objects.readPage(candidate));
    if (page.kind === "value") sizes.push(page.bytes);
    else {
      await visit(page.left);
      await visit(page.right);
    }
  };
  await visit(parts[0].reference);
  assert.ok(sizes.length > 1);
  assert.ok(sizes.slice(0, -1).every((size) => size === BLOCK_BYTES));
  assert.equal(
    sizes.reduce((sum, size) => sum + size, 0),
    bytes.length,
  );
  assert.equal((await auditImmutableSession({ sessionDir })).ok, true);
});

test("runtime open requires an explicit offline backend for old sessions", async (t) => {
  const { sessionDir } = await fixture(t);
  await assert.rejects(ImmutableSessionStore.open({ sessionDir }), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  const source = await ImmutableSessionStore.open({
    sessionDir,
    objectStore: ImmutableObjectStore,
  });
  assert.equal((await source.snapshot()).generation, 2);
});

test("source removal failure retries from the committed and verified segment head", async (t) => {
  const { sessionDir } = await fixture(t);
  const directory = path.join(sessionDir, "objects");
  const failure = new Error("source retirement failed");
  setFsAdapter({
    rm: async (file, options) => {
      if (file === directory) throw failure;
      return rm(file, options);
    },
  });
  try {
    await assert.rejects(
      migrateImmutableSessionSegments({ sessionDir }),
      (error) => error === failure,
    );
  } finally {
    resetFsAdapter();
  }
  assert.ok((await readdir(directory)).length);
  const store = await ImmutableSessionStore.open({ sessionDir });
  const committed = await readFile(store.headPath);
  assert.equal((await auditImmutableSession({ sessionDir })).ok, true);
  await migrateImmutableSessionSegments({ sessionDir });
  await assert.rejects(readdir(directory), { code: "ENOENT" });
  assert.deepEqual(await readFile(store.headPath), committed);
});

test("retry completes directory sync after source bytes were already removed", async (t) => {
  const { sessionDir } = await fixture(t);
  const directory = path.join(sessionDir, "objects");
  const failure = new Error("retirement directory sync failed");
  let removed = false;
  let syncs = 0;
  setFsAdapter({
    rm: async (file, options) => {
      const result = await rm(file, options);
      if (file === directory) removed = true;
      return result;
    },
    open: async (file, ...options) => {
      if (file !== sessionDir || !removed) return open(file, ...options);
      const handle = await open(file, ...options);
      return {
        sync: async () => {
          syncs += 1;
          throw failure;
        },
        close: () => handle.close(),
      };
    },
  });
  try {
    await assert.rejects(
      migrateImmutableSessionSegments({ sessionDir }),
      (error) => error === failure,
    );
    assert.equal(syncs, 1);
  } finally {
    resetFsAdapter();
  }
  await assert.rejects(readdir(directory), { code: "ENOENT" });
  await migrateImmutableSessionSegments({ sessionDir });
  assert.equal((await auditImmutableSession({ sessionDir })).ok, true);
});

test("retry preserves source bytes when the committed target graph is corrupt", async (t) => {
  const { sessionDir } = await fixture(t);
  const directory = path.join(sessionDir, "objects");
  const failure = new Error("retain source for retry");
  setFsAdapter({
    rm: async (file, options) => {
      if (file === directory) throw failure;
      return rm(file, options);
    },
  });
  try {
    await assert.rejects(
      migrateImmutableSessionSegments({ sessionDir }),
      (error) => error === failure,
    );
  } finally {
    resetFsAdapter();
  }
  const segments = path.join(sessionDir, "segments");
  const [segment] = await readdir(segments);
  await writeFile(path.join(segments, segment), "corrupt");
  await assert.rejects(migrateImmutableSessionSegments({ sessionDir }), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  assert.ok((await readdir(directory)).length);
});
