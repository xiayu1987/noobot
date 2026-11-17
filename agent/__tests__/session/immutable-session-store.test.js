/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile, rename, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { contentDigest } from "../../src/session/session-artifact-session/immutable-object-store.js";
import { observeSessionStorageWork } from "../../src/session/session-artifact-session/storage-transaction.js";
import { resetFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { committedPhysicalRecord, forbidRecordReads } from "./helpers/immutable-record-reads.js";

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "immutable-session-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sessionDir = path.join(directory, "session");
  return new ImmutableSessionStore({ sessionDir, sessionId: "session-1", allowCreate: true });
}

function request(generation, key, value) {
  return {
    expectedGeneration: generation,
    operationId: `op-${generation}`,
    changes: [{ collection: "messages", key, value }],
  };
}

test("immutable commit preserves snapshots, large values, deletion and idempotent outcomes after restart", async (t) => {
  const store = await fixture(t);
  const value = { text: "中文🙂".repeat(20000), messageUid: "m1" };
  const operation = request(0, "m1", value);
  const first = await store.commit(operation);
  const initial = await store.snapshot();
  assert.deepEqual(await store.get(initial, "messages", "m1"), value);
  await store.commit(request(1, "m1", { text: "changed" }));
  assert.deepEqual(await store.get(initial, "messages", "m1"), value);
  const reopened = new ImmutableSessionStore({
    sessionDir: store.sessionDir,
    sessionId: store.sessionId,
  });
  assert.deepEqual(await reopened.commit(operation), { ...first, replayed: true });
  await assert.rejects(reopened.commit(request(0, "m1", "other")), {
    code: "SESSION_OPERATION_CONFLICT",
  });
  await assert.rejects(reopened.commit({ ...request(0, "m2", "other"), operationId: "conflict" }), {
    code: "SESSION_GENERATION_CONFLICT",
  });
  await reopened.commit({
    expectedGeneration: 2,
    operationId: "remove",
    changes: [{ collection: "messages", key: "m1", remove: true }],
  });
  assert.equal(await reopened.get(await reopened.snapshot(), "messages", "m1"), null);
  assert.deepEqual(await reopened.get(initial, "messages", "m1"), value);
});

test("two writers racing on one generation publish exactly one complete commit", async (t) => {
  const store = await fixture(t);
  const other = new ImmutableSessionStore({
    sessionDir: store.sessionDir,
    sessionId: store.sessionId,
    allowCreate: true,
  });
  const results = await Promise.allSettled([
    store.commit(request(0, "a", { value: 1 })),
    other.commit({ ...request(0, "b", { value: 2 }), operationId: "second" }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(
    results.find((result) => result.status === "rejected").reason.code,
    "SESSION_GENERATION_CONFLICT",
  );
  const snapshot = await store.snapshot();
  assert.equal(snapshot.generation, 1);
  const entries = [];
  for await (const entry of store.entries(snapshot, "messages")) entries.push(entry);
  assert.equal(entries.length, 1);
});

test("failed head replacement leaves previous graph readable and same operation retries safely", async (t) => {
  const store = await fixture(t);
  await store.commit(request(0, "a", 1));
  const before = await readFile(store.headPath);
  setFsAdapter({
    rename: async (source, target) => {
      if (target === store.headPath)
        throw Object.assign(new Error("injected head failure"), { code: "EIO" });
      return rename(source, target);
    },
  });
  try {
    await assert.rejects(store.commit(request(1, "a", 2)), { code: "SESSION_COMMIT_UNCERTAIN" });
  } finally {
    resetFsAdapter();
  }
  assert.deepEqual(await readFile(store.headPath), before);
  assert.equal(await store.get(await store.snapshot(), "messages", "a"), 1);
  await store.commit(request(1, "a", 2));
  assert.equal(await store.get(await store.snapshot(), "messages", "a"), 2);
});

test("directory sync failure after head rename is resolved by idempotent retry", async (t) => {
  const store = await fixture(t);
  await store.commit(request(0, "a", 1));
  let published = false;
  setFsAdapter({
    rename: async (source, target) => {
      await rename(source, target);
      if (target === store.headPath) published = true;
    },
    open: async (file, flags) => {
      const handle = await open(file, flags);
      if (file !== store.sessionDir || !published) return handle;
      return {
        sync: async () => {
          throw new Error("injected directory sync failure");
        },
        close: () => handle.close(),
      };
    },
  });
  try {
    await assert.rejects(store.commit(request(1, "a", 2)), { code: "SESSION_COMMIT_UNCERTAIN" });
  } finally {
    resetFsAdapter();
  }
  const result = await store.commit(request(1, "a", 2));
  assert.equal(result.replayed, true);
  assert.equal((await store.snapshot()).generation, 2);
});

test("segment rollover directory sync failure preserves the head until a durable retry", async (t) => {
  const store = await fixture(t);
  await store.commit(request(0, "a", 1));
  const before = await readFile(store.headPath);

  const value = {
    fault: "object-directory-not-durable",
    body: randomBytes(2 * 1024 * 1024).toString("hex"),
  };
  const objectDirectory = store.objects.segments.directory;
  let renamed = false;
  let failures = 0;
  setFsAdapter({
    rename: async (source, target) => {
      await rename(source, target);
      if (path.dirname(target) === objectDirectory) renamed = true;
    },
    open: async (file, flags) => {
      const handle = await open(file, flags);
      if (!renamed || file !== objectDirectory) return handle;
      return {
        sync: async () => {
          failures += 1;
          throw new Error("object directory sync failed");
        },
        close: () => handle.close(),
      };
    },
  });
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await assert.rejects(store.commit(request(1, "a", value)), /object directory sync failed/);
      assert.deepEqual(await readFile(store.headPath), before);
    }
    assert.equal(failures, 2);
  } finally {
    resetFsAdapter();
  }
  await store.commit(request(1, "a", value));
  assert.deepEqual(await store.get(await store.snapshot(), "messages", "a"), value);
});

test("corruption and missing blocks fail on access without silently reverting committed state", async (t) => {
  const store = await fixture(t);
  await store.commit(request(0, "a", { value: 1 }));
  const snapshot = await store.snapshot();
  const rootRecord = await committedPhysicalRecord(store, snapshot.root);
  const rootFile = store.objects.segments.segmentPath(rootRecord.segmentId);
  const bytes = await readFile(rootFile);
  const corrupt = Buffer.from(bytes);
  corrupt[rootRecord.offset] ^= 1;
  await writeFile(rootFile, corrupt);
  await assert.rejects(store.get(snapshot, "messages", "a"), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  await writeFile(rootFile, bytes);
  await rm(rootFile);
  await assert.rejects(store.get(snapshot, "messages", "a"), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  await writeFile(store.headPath, "{}");
  await assert.rejects(store.snapshot(), { code: "SESSION_IMMUTABLE_STORAGE_INVALID" });
});

test("missing head cannot turn an opened or previously committed session into a new session", async (t) => {
  const store = await fixture(t);
  const opened = new ImmutableSessionStore({
    sessionDir: store.sessionDir,
    sessionId: store.sessionId,
  });
  await assert.rejects(opened.snapshot(), { code: "SESSION_IMMUTABLE_STORAGE_INVALID" });
  await store.commit(request(0, "a", 1));
  await rm(store.headPath);
  for (const reader of [store, opened]) {
    await assert.rejects(reader.snapshot(), { code: "SESSION_IMMUTABLE_STORAGE_INVALID" });
    await assert.rejects(reader.commit(request(0, "b", 2)), {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    });
  }
});

test("cold delta commits visit bounded index paths and never read unrelated historical values", async (t) => {
  const store = await fixture(t);
  const changes = Array.from({ length: 512 }, (_, index) => ({
    collection: "messages",
    key: `history-${index}`,
    value: { payload: `history-payload-${index}` },
  }));
  await store.commit({ expectedGeneration: 0, operationId: "seed", changes });
  const head = await store.snapshot();
  const bodies = new Set();
  await store.objects.withSnapshot(head, async () => {
    const historyRoot = await store.index.get(head.root, "messages");
    for await (const [, reference] of store.index.entries(historyRoot)) {
      const page = await store.objects.readPage(reference);
      bodies.add(page.kind === "value-inline" ? reference : page.data);
    }
  });
  const reopened = new ImmutableSessionStore({
    sessionDir: store.sessionDir,
    sessionId: store.sessionId,
  });
  let work;
  setFsAdapter(await forbidRecordReads(store, bodies));
  try {
    ({ work } = await observeSessionStorageWork(() =>
      reopened.commit(request(1, "current", { payload: "new" })),
    ));
  } finally {
    resetFsAdapter();
  }
  assert.ok(work.immutableIndexPageReads < 40, JSON.stringify(work));
  assert.ok(work.immutableReadBytes < 32768, JSON.stringify(work));
  assert.ok(work.immutableHeadWriteBytes < 4096, JSON.stringify(work));
  assert.deepEqual(await reopened.get(await reopened.snapshot(), "messages", "current"), {
    payload: "new",
  });
  assert.deepEqual(await reopened.get(await reopened.snapshot(), "messages", "history-0"), {
    payload: "history-payload-0",
  });
});

test("transaction prepares against the locked generation and replays its durable business result", async (t) => {
  const store = await fixture(t);
  await store.commit(request(0, "a", { count: 1 }));
  let preparations = 0;
  const operation = {
    expectedGeneration: 1,
    operationId: "increment",
    input: { amount: 2 },
    prepare: async ({ get, input, snapshot }) => {
      preparations += 1;
      assert.equal(snapshot.generation, 1);
      const previous = await get("messages", "a");
      return {
        changes: [
          { collection: "messages", key: "a", value: { count: previous.count + input.amount } },
        ],
        result: { previous: previous.count, count: previous.count + input.amount },
      };
    },
  };
  const first = await store.transact(operation);
  assert.deepEqual(first.result, { previous: 1, count: 3 });
  first.result.count = 100;
  const reopened = new ImmutableSessionStore({
    sessionDir: store.sessionDir,
    sessionId: store.sessionId,
  });
  const replay = await reopened.transact(operation);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.result, { previous: 1, count: 3 });
  assert.equal(preparations, 1);
  await assert.rejects(reopened.transact({ ...operation, input: { amount: 3 } }), {
    code: "SESSION_OPERATION_CONFLICT",
  });
  await assert.rejects(reopened.transact({ ...operation, operationId: "stale" }), {
    code: "SESSION_GENERATION_CONFLICT",
  });
  assert.equal(preparations, 1);
});

test("runtime and offline head readers enforce the same bounded root schema", async (t) => {
  const store = await fixture(t);
  await store.commit(request(0, "a", 1));
  const validBytes = await readFile(store.headPath);
  const validEnvelope = JSON.parse(validBytes);
  const validHead = JSON.parse(validEnvelope.payload);
  const envelopeFor = (head) => {
    const payload = JSON.stringify(head);
    return JSON.stringify({ payload, checksum: contentDigest(payload) });
  };
  const invalidHeads = [
    null,
    [],
    { ...validHead, turnOrder: [] },
    { ...validHead, generation: 0 },
    { ...validHead, operations: null },
    { ...validHead, commit: "invalid-reference" },
    Object.fromEntries(Object.entries(validHead).filter(([key]) => key !== "root")),
  ];
  const invalidBytes = [
    ...invalidHeads.map(envelopeFor),
    JSON.stringify({ ...validEnvelope, history: [] }),
    JSON.stringify({ ...validEnvelope, checksum: "invalid-checksum" }),
    " ".repeat(4097),
  ];
  for (const bytes of invalidBytes) {
    await writeFile(store.headPath, bytes);
    await assert.rejects(store.snapshot(), { code: "SESSION_IMMUTABLE_STORAGE_INVALID" });
    await assert.rejects(ImmutableSessionStore.open({ sessionDir: store.sessionDir }), {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    });
  }
  await writeFile(store.headPath, validBytes);
  const discovered = await ImmutableSessionStore.open({ sessionDir: store.sessionDir });
  assert.deepEqual(await discovered.snapshot(), validHead);
  const wrongOwner = new ImmutableSessionStore({
    sessionDir: store.sessionDir,
    sessionId: "other",
  });
  await assert.rejects(wrongOwner.snapshot(), { code: "SESSION_IMMUTABLE_STORAGE_INVALID" });
});

test("preparation failure publishes nothing and a retry prepares again", async (t) => {
  const store = await fixture(t);
  await store.commit(request(0, "a", 1));
  const before = await readFile(store.headPath);
  const operation = { expectedGeneration: 1, operationId: "prepare-failure", input: null };
  await assert.rejects(
    store.transact({
      ...operation,
      prepare: async () => {
        throw new Error("validation failed");
      },
    }),
    /validation failed/,
  );
  assert.deepEqual(await readFile(store.headPath), before);
  const result = await store.transact({
    ...operation,
    prepare: async ({ get }) => ({
      changes: [{ collection: "messages", key: "a", value: (await get("messages", "a")) + 1 }],
      result: { accepted: true },
    }),
  });
  assert.deepEqual(result.result, { accepted: true });
  assert.equal(await store.get(await store.snapshot(), "messages", "a"), 2);
});

test("commit batches segment durability before head publication including prepared records", async (t) => {
  const store = await fixture(t);
  const objectDirectories = new Set();
  const synchronizedFiles = new Set();
  const directorySyncs = new Map();
  let published = false;
  setFsAdapter({
    open: async (file, flags) => {
      const handle = await open(file, flags);
      return {
        read: (...args) => handle.read(...args),
        stat: (...args) => handle.stat(...args),
        write: (...args) => handle.write(...args),
        truncate: (...args) => handle.truncate(...args),
        writeFile: (...args) => handle.writeFile(...args),
        sync: async () => {
          await handle.sync();
          if (flags === "r") directorySyncs.set(file, (directorySyncs.get(file) ?? 0) + 1);
          else synchronizedFiles.add(file);
        },
        close: () => handle.close(),
      };
    },
    rename: async (source, target) => {
      if (
        target === store.headPath ||
        target.startsWith(`${store.objects.segments.directory}${path.sep}`)
      )
        assert.ok(synchronizedFiles.has(source), "every replacement must synchronize its file");
      if (target.startsWith(`${store.objects.segments.directory}${path.sep}`)) {
        assert.equal(published, false);
        objectDirectories.add(path.dirname(target));
      }
      if (target === store.headPath) {
        for (const directory of objectDirectories) assert.equal(directorySyncs.get(directory), 1);
        assert.equal(directorySyncs.get(store.sessionDir), 1);
        published = true;
      }
      await rename(source, target);
    },
  });
  let observation;
  try {
    observation = await observeSessionStorageWork(() =>
      store.transact({
        expectedGeneration: 0,
        operationId: "batch-directory-sync",
        input: null,
        prepare: async () => {
          const preparedReference = await store.objects.putValue({ prepared: true });
          const preparedRoot = await store.index.set(null, "member", preparedReference);
          return {
            changes: [
              ...Array.from({ length: 64 }, (_, index) => ({
                collection: "messages",
                key: `message-${index}`,
                value: { index },
              })),
              {
                collection: "dialogTurns",
                key: "prepared-dialog",
                value: { count: 1, root: preparedRoot },
              },
            ],
          };
        },
      }),
    );
  } finally {
    resetFsAdapter();
  }
  assert.equal(published, true);
  assert.equal(
    directorySyncs.get(store.sessionDir),
    2,
    "head replacement requires its own directory sync",
  );
  assert.equal(observation.work.immutableDirectorySyncs, objectDirectories.size + 3);
  assert.equal(observation.work.immutableSegmentWrites, 1);
  assert.equal(observation.work.immutableSegmentSyncs, 1);
  const snapshot = await store.snapshot();
  const membership = await store.get(snapshot, "dialogTurns", "prepared-dialog");
  await store.objects.withSnapshot(snapshot, async () => {
    const reference = await store.index.get(membership.root, "member");
    assert.deepEqual(await store.objects.readValue(reference), { prepared: true });
  });
});
