/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, open, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { IMMUTABLE_READER_RETENTION as RETENTION } from "@noobot/session-protocol/immutable-storage";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { openSessionArtifactReader } from "../../src/session/session-artifact-session/immutable-session-reader.js";
import {
  auditImmutableSession,
  auditImmutableSnapshot,
} from "../../src/session/session-artifact-session/immutable-session-audit.js";
import {
  withImmutableAuditRetention,
  readImmutableReaderRetentions,
} from "../../src/session/session-artifact-session/immutable-reader-retention.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { prepareAndCleanupSessionArtifacts } from "../helpers/immutable-cleanup.js";
import { TEST_STORAGE_SERVICE as storageService } from "../helpers/storage-service.js";

async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "audit-retention-"));
  const owned = [];
  t.after(async () => {
    resetFsAdapter();
    for (const reader of owned) await reader.close();
    await rm(sessionDir, { recursive: true, force: true });
  });
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "audit", allowCreate: true });
  const advance = async (operationId) =>
    store.commit({
      expectedGeneration: (await store.snapshot()).generation,
      operationId,
      changes: [
        {
          collection: "metadata",
          key: "session",
          value: { sessionId: "audit", parentSessionId: "", operationId },
        },
      ],
    });
  await advance("first");
  const reader = await openSessionArtifactReader({ sessionDir });
  owned.push(reader);
  const historical = await store.snapshot();
  await advance("second");
  const collect = () =>
    prepareAndCleanupSessionArtifacts({
      storageService,
      sessionDir,
      assertSessionWritable: async () => {},
      dryRun: false,
    });
  return { sessionDir, store, reader, historical, advance, collect };
}

test("an audit retains captured readers independently until its scope ends", async (t) => {
  const { sessionDir, store, reader, historical, collect } = await fixture(t);
  await withImmutableAuditRetention(store, undefined, async ({ head, retainedSnapshots }) => {
    assert.equal(head.generation, 2);
    assert.deepEqual(retainedSnapshots, [historical]);
    await reader.close();
    await collect();
    await store.objects.withSnapshot(historical, () => store.objects.readPage(historical.root));
    assert.deepEqual(
      new Set(await readImmutableReaderRetentions(store, head)),
      new Set([historical, head]),
    );
  });
  assert.deepEqual(await readdir(path.join(sessionDir, RETENTION.directory)), []);
  await collect();
  assert.deepEqual(await readImmutableReaderRetentions(store, await store.snapshot()), []);
  await store.objects.withSnapshot(historical, () => store.objects.readPage(historical.root));
});

test("public audit pins one generation across reader close, a commit and concurrent collection", async (t) => {
  const { sessionDir, store, reader, historical, advance, collect } = await fixture(t);
  let interleaved = false;
  setFsAdapter({
    open: async (file, flags, ...args) => {
      if (
        !interleaved &&
        flags === "r" &&
        String(file).startsWith(store.objects.segments.directory + path.sep)
      ) {
        interleaved = true;
        await reader.close();
        await advance("during-audit");
        await collect();
        await store.objects.withSnapshot(historical, () => store.objects.readPage(historical.root));
      }
      return open(file, flags, ...args);
    },
  });
  const report = await auditImmutableSession({ sessionDir, batchSize: 1 });
  resetFsAdapter();
  assert.equal(interleaved, true);
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(report.generation, 2);
  assert.equal((await store.snapshot()).generation, 3);
  assert.deepEqual(await readdir(path.join(sessionDir, RETENTION.directory)), []);
  await collect();
  assert.deepEqual(await readImmutableReaderRetentions(store, await store.snapshot()), []);
  await store.objects.withSnapshot(historical, () => store.objects.readPage(historical.root));
});

test("cancelled audit acquisition rolls back every independently published retention", async (t) => {
  const { sessionDir, store, reader } = await fixture(t);
  const directory = path.join(sessionDir, RETENTION.directory);
  const original = await readdir(directory);
  const abort = new AbortController();
  const reason = new Error("cancel acquisition");
  let publications = 0;
  setFsAdapter({
    open: async (file, flags, ...args) => {
      const handle = await open(file, flags, ...args);
      if (flags === "wx" && String(file).startsWith(directory + path.sep) && ++publications === 1)
        abort.abort(reason);
      return handle;
    },
  });
  await assert.rejects(
    withImmutableAuditRetention(store, abort.signal, async () =>
      assert.fail("cancelled scope entered"),
    ),
    (error) => error === reason,
  );
  resetFsAdapter();
  assert.deepEqual(await readdir(directory), original);
  assert.equal((await reader.readMetadata()).operationId, "first");
});

for (const [scopeFails, failedSyncs] of [
  [false, 1],
  [true, 1],
  [false, 2],
  [true, 2],
]) {
  test(`audit release preserves ${failedSyncs} sync failures and drains all roots (scope fails: ${scopeFails})`, async (t) => {
    const { sessionDir, store } = await fixture(t);
    const directory = path.join(sessionDir, RETENTION.directory);
    const before = await readdir(directory);
    const releaseFailures = Array.from(
      { length: failedSyncs },
      (_, index) => new Error(`retention sync ${index} failed`),
    );
    const scopeFailure = new Error("audit failed");
    let releasing = false;
    let attempts = 0;
    setFsAdapter({
      open: async (file, flags, ...args) => {
        const handle = await open(file, flags, ...args);
        if (releasing && flags === "r" && String(file) === directory) {
          const sync = handle.sync.bind(handle);
          handle.sync = async () => {
            attempts += 1;
            if (attempts <= failedSyncs) throw releaseFailures[attempts - 1];
            return sync();
          };
        }
        return handle;
      },
    });
    await assert.rejects(
      withImmutableAuditRetention(store, undefined, async () => {
        releasing = true;
        if (scopeFails) throw scopeFailure;
      }),
      (error) => {
        const releaseError = scopeFails ? error.errors[1] : error;
        if (failedSyncs === 1) assert.equal(releaseError, releaseFailures[0]);
        else {
          assert.ok(releaseError instanceof AggregateError);
          assert.deepEqual(releaseError.errors, releaseFailures);
        }
        if (!scopeFails) return true;
        assert.ok(error instanceof AggregateError);
        assert.deepEqual(error.errors, [scopeFailure, releaseError]);
        assert.equal(error.cause, scopeFailure);
        return true;
      },
    );
    resetFsAdapter();
    assert.equal(attempts, 2);
    assert.deepEqual(await readdir(directory), before);
  });
}

test("invalid audit options reject before publishing retention records", async (t) => {
  const { sessionDir } = await fixture(t);
  const directory = path.join(sessionDir, RETENTION.directory);
  const before = await readdir(directory);
  for (const options of [{ batchSize: 0 }, { retainedObjects: [] }, { maxObjectReads: 0 }])
    await assert.rejects(auditImmutableSession({ sessionDir, ...options }), TypeError);
  assert.deepEqual(await readdir(directory), before);
});

test("snapshot audits release their read budget and cancellation scope on every exit", async (t) => {
  const { store } = await fixture(t);
  const snapshot = await store.snapshot();
  const originalRead = store.objects.read;
  const retainedObjects = new Set();
  const limited = await auditImmutableSnapshot({
    store,
    snapshot,
    retainedObjects,
    maxObjectReads: 1,
  });
  assert.equal(limited.ok, false);
  assert.equal(limited.objectReads, 1);
  assert.equal(store.objects.read, originalRead);
  const retainedCount = retainedObjects.size;
  await store.objects.withSnapshot(snapshot, () => store.objects.read(snapshot.commit));
  assert.equal(retainedObjects.size, retainedCount);
  const abort = new AbortController();
  const complete = await auditImmutableSnapshot({ store, snapshot, signal: abort.signal });
  assert.equal(complete.ok, true, JSON.stringify(complete));
  assert.equal(store.objects.read, originalRead);
  const reason = new Error("closed audit scope");
  abort.abort(reason);
  await store.objects.withSnapshot(snapshot, () => store.objects.read(snapshot.commit));
  await assert.rejects(
    auditImmutableSnapshot({ store, snapshot, signal: abort.signal }),
    (error) => error === reason,
  );
  assert.equal(store.objects.read, originalRead);
  await store.objects.withSnapshot(snapshot, () => store.objects.read(snapshot.commit));
});

test("overlapping snapshot audits keep independent budgets while source reads remain usable", async (t) => {
  const { store } = await fixture(t);
  const snapshot = await store.snapshot();
  const originalRead = store.objects.read;
  let resume;
  let entered;
  const paused = new Promise((resolve) => {
    entered = resolve;
  });
  const gate = new Promise((resolve) => {
    resume = resolve;
  });
  let blocked = false;
  t.mock.method(store.objects.constructor.prototype, "read", async function (reference) {
    if (this !== store.objects && !blocked) {
      blocked = true;
      entered();
      await gate;
    }
    return originalRead.call(this, reference);
  });
  const sourceRead = store.objects.read;
  const limited = auditImmutableSnapshot({ store, snapshot, maxObjectReads: 1 });
  try {
    await paused;
    assert.equal(store.objects.read, sourceRead);
    await store.objects.withSnapshot(snapshot, () => store.objects.read(snapshot.commit));
    const complete = await auditImmutableSnapshot({ store, snapshot });
    assert.equal(complete.ok, true, JSON.stringify(complete));
  } finally {
    resume();
    const report = await limited;
    assert.equal(store.objects.read, sourceRead);
    assert.equal(report.ok, false);
    assert.equal(report.objectReads, 1);
  }
});
