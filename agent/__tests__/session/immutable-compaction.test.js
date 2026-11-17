/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdtemp, readFile, rename, rm, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import {
  compactSessionArtifacts,
  retireSessionArtifactLocations,
  discardSessionArtifactLocationRetirement,
  cleanupSessionArtifacts,
  discardSessionArtifactCleanup,
} from "../../src/session/index.js";
import { acquireImmutableReaderRetention } from "../../src/session/session-artifact-session/immutable-reader-retention.js";
import { auditImmutableSession } from "../../src/session/session-artifact-session/immutable-session-audit.js";
import { TEST_STORAGE_SERVICE as storageService } from "../helpers/storage-service.js";
import { prepareSessionArtifactCleanupToCompletion as prepareSessionArtifactCleanup } from "../helpers/immutable-cleanup.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { decodeImmutableRecordReference } from "@noobot/session-protocol/immutable-segment";
import { observeSessionStorageWork } from "../../src/session/session-artifact-session/storage-transaction.js";

async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-compaction-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "compact", allowCreate: true });
  await store.commit({
    expectedGeneration: 0,
    operationId: "seed",
    changes: [{ collection: "metadata", key: "item", value: { kept: true } }],
  });
  const first = await store.snapshot();
  const identity = await store.objects.withSnapshot(first, async () =>
    store.index.get(await store.index.get(first.root, "metadata"), "item"),
  );
  const sourceLocation = await store.objects.locations.get(first.locationRoot, identity);

  const body = Array.from(
    { length: 80 },
    (_, i) => `${i}:` + String.fromCharCode(33 + i).repeat(65536),
  ).join("");
  await store.commit({
    expectedGeneration: 1,
    operationId: "rollover",
    changes: [{ collection: "metadata", key: "large", value: body }],
  });
  const before = await store.snapshot();
  assert.notEqual(
    before.segmentTail.segmentId,
    decodeImmutableRecordReference(sourceLocation).segmentId,
  );
  const request = {
    storageService,
    sessionDir,
    expectedGeneration: before.generation,
    assertSessionWritable: async () => {},
    operationId: "compact-batch",
    records: [{ identity, sourceLocation }],
  };
  return { store, first, before, request, identity, sourceLocation };
}

for (const published of [false, true]) {
  test(`maintenance relocation resumes after ${published ? "published" : "unpublished"} head failure`, async (t) => {
    const { store, before, request, identity, sourceLocation } = await fixture(t);
    const reader = await acquireImmutableReaderRetention(store, async () => {});
    try {
      const failure = new Error("lost compaction acknowledgement");
      setFsAdapter({
        rename: async (source, target) => {
          if (target !== store.headPath) return rename(source, target);
          if (published) await rename(source, target);
          throw failure;
        },
      });
      try {
        await assert.rejects(compactSessionArtifacts(request), {
          code: "SESSION_COMMIT_UNCERTAIN",
          cause: failure,
        });
      } finally {
        resetFsAdapter();
      }
      const { result, work } = await observeSessionStorageWork(() =>
        compactSessionArtifacts(request),
      );
      assert.equal(result.replayed, published);
      assert.equal(result.generation, before.generation + 1);
      assert.deepEqual(result.result, { relocatedRecords: 1, conflicts: [] });
      assert.ok((work.immutableReadBytes ?? 0) < 200000, JSON.stringify(work));
      assert.ok((work.immutableWriteBytes ?? 0) < 100000, JSON.stringify(work));
      const reopened = await ImmutableSessionStore.open({ sessionDir: request.sessionDir });
      const current = await reopened.snapshot();
      assert.notEqual(
        await reopened.objects.locations.get(current.locationRoot, identity),
        sourceLocation,
      );
      for (const snapshot of [reader.head, current])
        assert.deepEqual(await reopened.get(snapshot, "metadata", "item"), { kept: true });
      const bytes = await readFile(store.headPath);
      assert.equal((await compactSessionArtifacts(request)).replayed, true);
      assert.deepEqual(await readFile(store.headPath), bytes);
      assert.equal((await auditImmutableSession({ sessionDir: request.sessionDir })).ok, true);
    } finally {
      await reader.release();
    }
  });
}

test("compaction records changed sources but rejects active tail, cancellation and writability failures", async (t) => {
  const { store, request, identity, sourceLocation } = await fixture(t);
  await compactSessionArtifacts(request);
  const current = await store.snapshot();
  const retry = { ...request, expectedGeneration: current.generation, operationId: "stale-source" };
  const activeLocation = await store.objects.locations.get(current.locationRoot, identity);
  const conflict = await compactSessionArtifacts(retry);
  assert.deepEqual(conflict.result, {
    relocatedRecords: 0,
    conflicts: [{ identity, sourceLocation, currentLocation: activeLocation }],
  });
  assert.equal(conflict.generation, current.generation + 1);
  const headBytes = await readFile(store.headPath);
  assert.deepEqual((await compactSessionArtifacts(retry)).result, conflict.result);
  assert.equal(
    decodeImmutableRecordReference(activeLocation).segmentId,
    current.segmentTail.segmentId,
  );
  await assert.rejects(
    compactSessionArtifacts({
      ...retry,
      expectedGeneration: conflict.generation,
      operationId: "active-source",
      records: [{ identity, sourceLocation: activeLocation }],
    }),
    {
      code: "SESSION_COMPACTION_ACTIVE_SEGMENT",
    },
  );
  const denied = new Error("session write denied");
  await assert.rejects(
    compactSessionArtifacts({
      ...request,
      assertSessionWritable: async () => {
        throw denied;
      },
    }),
    (error) => error === denied,
  );
  const controller = new AbortController();
  controller.abort(denied);
  await assert.rejects(
    compactSessionArtifacts({ ...request, signal: controller.signal }),
    (error) => error === denied,
  );
  assert.deepEqual(await readFile(store.headPath), headBytes);
  assert.equal(
    await store.objects.locations.get((await store.snapshot()).locationRoot, identity),
    activeLocation,
  );
  assert.notEqual(activeLocation, sourceLocation);
});

for (const published of [false, true]) {
  test(`mixed compaction preserves per-source progress after ${published ? "published" : "unpublished"} failure`, async (t) => {
    const { store, request, before, identity, sourceLocation } = await fixture(t);
    let other;
    for await (const [candidate, location] of store.objects.locations.entries(
      before.locationRoot,
    )) {
      if (
        candidate !== identity &&
        decodeImmutableRecordReference(location).segmentId ===
          decodeImmutableRecordReference(sourceLocation).segmentId
      ) {
        other = { identity: candidate, sourceLocation: location };
        break;
      }
    }
    assert.ok(other);
    await compactSessionArtifacts(request);
    const current = await store.snapshot();
    const currentLocation = await store.objects.locations.get(current.locationRoot, identity);
    const mixed = {
      ...request,
      expectedGeneration: current.generation,
      operationId: "mixed-sources",

      records: [other, { identity, sourceLocation }],
    };
    const failure = new Error("mixed batch lost acknowledgement");
    setFsAdapter({
      rename: async (source, target) => {
        if (target !== store.headPath) return rename(source, target);
        if (published) await rename(source, target);
        throw failure;
      },
    });
    try {
      await assert.rejects(compactSessionArtifacts(mixed), {
        code: "SESSION_COMMIT_UNCERTAIN",
        cause: failure,
      });
    } finally {
      resetFsAdapter();
    }
    const result = await compactSessionArtifacts(mixed);
    assert.equal(result.replayed, published);
    assert.deepEqual(result.result, {
      relocatedRecords: 1,
      conflicts: [{ identity, sourceLocation, currentLocation }],
    });
    const reopened = await ImmutableSessionStore.open({ sessionDir: request.sessionDir });
    const after = await reopened.snapshot();
    const moved = await reopened.objects.locations.get(after.locationRoot, other.identity);
    assert.notEqual(moved, other.sourceLocation);
    assert.equal(
      await reopened.objects.locations.get(after.locationRoot, identity),
      currentLocation,
    );
    const headBytes = await readFile(store.headPath);
    assert.deepEqual((await compactSessionArtifacts(mixed)).result, result.result);
    assert.deepEqual(await readFile(store.headPath), headBytes);
    assert.equal((await auditImmutableSession({ sessionDir: request.sessionDir })).ok, true);
  });
}

test("a source retired after discovery conflicts without blocking live records or resurrecting it", async (t) => {
  const { store, first, before, request, identity, sourceLocation } = await fixture(t);
  const obsolete = {
    identity: first.root,
    sourceLocation: await store.objects.locations.get(before.locationRoot, first.root),
  };
  const reader = await acquireImmutableReaderRetention(store, async () => {});
  try {
    const retirement = {
      ...request,
      operationId: "retire-discovered-root",
      records: [obsolete],
      maxTasks: 128,
    };
    let complete = false;
    for (let batch = 0; batch < 300 && !complete; batch += 1)
      complete = (await retireSessionArtifactLocations(retirement)).complete;
    assert.equal(complete, true, "retirement must converge within the fixture work bound");
    await discardSessionArtifactLocationRetirement(retirement);
    const retired = await store.snapshot();
    assert.equal(await store.objects.locations.get(retired.locationRoot, obsolete.identity), null);
    const mixed = {
      ...request,
      operationId: "compact-after-retirement",
      expectedGeneration: retired.generation,
      records: [obsolete, { identity, sourceLocation }],
    };
    const outcome = await compactSessionArtifacts(mixed);
    assert.deepEqual(outcome.result, {
      relocatedRecords: 1,
      conflicts: [{ ...obsolete, currentLocation: null }],
    });
    const reopened = await ImmutableSessionStore.open({ sessionDir: request.sessionDir });
    const current = await reopened.snapshot();
    assert.equal(
      await reopened.objects.locations.get(current.locationRoot, obsolete.identity),
      null,
    );
    assert.notEqual(
      await reopened.objects.locations.get(current.locationRoot, identity),
      sourceLocation,
    );
    assert.deepEqual(await reopened.get(current, "metadata", "item"), { kept: true });
    await reopened.objects.withSnapshot(reader.head, () =>
      reopened.objects.readPage(obsolete.identity),
    );
    const headBytes = await readFile(store.headPath);
    const replayed = await compactSessionArtifacts(mixed);
    assert.equal(replayed.replayed, true);
    assert.deepEqual(replayed.result, outcome.result);
    assert.deepEqual(await readFile(store.headPath), headBytes);
    assert.equal((await auditImmutableSession({ sessionDir: request.sessionDir })).ok, true);
  } finally {
    await reader.release();
  }
});

test("corrupt source fails the complete transaction instead of becoming a reported conflict", async (t) => {
  const { store, request, before, identity, sourceLocation } = await fixture(t);
  let valid;
  for await (const [candidate, location] of store.objects.locations.entries(before.locationRoot)) {
    if (
      candidate !== identity &&
      decodeImmutableRecordReference(location).segmentId ===
        decodeImmutableRecordReference(sourceLocation).segmentId
    ) {
      valid = { identity: candidate, sourceLocation: location };
      break;
    }
  }
  assert.ok(valid);
  const record = decodeImmutableRecordReference(sourceLocation);
  const handle = await open(store.objects.segments.segmentPath(record.segmentId), "r+");
  const original = Buffer.alloc(1);
  await handle.read(original, 0, 1, record.offset);
  const headBytes = await readFile(store.headPath);
  const mixed = { ...request, records: [valid, { identity, sourceLocation }] };
  try {
    await handle.write(Buffer.from([original[0] ^ 1]), 0, 1, record.offset);
    const { work } = await observeSessionStorageWork(async () => {
      await assert.rejects(compactSessionArtifacts(mixed), {
        code: "SESSION_IMMUTABLE_STORAGE_INVALID",
      });
    });
    assert.equal(work.immutableWriteBytes ?? 0, 0);
    assert.deepEqual(await readFile(store.headPath), headBytes);
  } finally {
    try {
      await handle.write(original, 0, 1, record.offset);
    } finally {
      await handle.close();
    }
  }

  const repaired = await compactSessionArtifacts(mixed);
  assert.deepEqual(repaired.result, { relocatedRecords: 2, conflicts: [] });
  assert.equal(repaired.replayed, false);
  assert.equal((await auditImmutableSession({ sessionDir: request.sessionDir })).ok, true);
});

test("concurrent compaction retries share one receipt and retain replay after later commits", async (t) => {
  const { store, before, request, identity } = await fixture(t);
  const results = await Promise.all([
    compactSessionArtifacts(request),
    compactSessionArtifacts(request),
  ]);
  assert.deepEqual(results.map((result) => result.replayed).sort(), [false, true]);
  assert.ok(results.every((result) => result.generation === before.generation + 1));
  const published = await store.snapshot();
  const location = await store.objects.locations.get(published.locationRoot, identity);
  await store.commit({
    expectedGeneration: published.generation,
    operationId: "ordinary-after-compaction",
    changes: [{ collection: "metadata", key: "unrelated", value: true }],
  });
  const bytes = await readFile(store.headPath);
  const replay = await compactSessionArtifacts(request);
  assert.equal(replay.replayed, true);
  assert.equal(replay.generation, published.generation);
  assert.deepEqual(await readFile(store.headPath), bytes);
  assert.equal(
    await store.objects.locations.get((await store.snapshot()).locationRoot, identity),
    location,
  );
  await assert.rejects(
    compactSessionArtifacts({ ...request, expectedGeneration: published.generation }),
    {
      code: "SESSION_OPERATION_CONFLICT",
    },
  );
  assert.deepEqual(await readFile(store.headPath), bytes);
});

test("ordinary commits preserve source evidence and compaction never overwrites a newer generation", async (t) => {
  const { store, before, request, identity, sourceLocation } = await fixture(t);
  await store.commit({
    expectedGeneration: before.generation,
    operationId: "ordinary-before-compaction",
    changes: [{ collection: "metadata", key: "unrelated", value: true }],
  });
  const bytes = await readFile(store.headPath);
  await assert.rejects(compactSessionArtifacts(request), { code: "SESSION_GENERATION_CONFLICT" });
  assert.deepEqual(await readFile(store.headPath), bytes);
  const current = await store.snapshot();
  assert.equal(await store.objects.locations.get(current.locationRoot, identity), sourceLocation);
  const result = await compactSessionArtifacts({
    ...request,
    expectedGeneration: current.generation,
  });
  assert.equal(result.replayed, false);
  assert.equal(result.generation, current.generation + 1);
  assert.equal(await store.get(await store.snapshot(), "metadata", "unrelated"), true);
});

test("evacuated segment is reclaimed only after its old reader releases", async (t) => {
  const { store, before, request, sourceLocation } = await fixture(t);
  const oldSegmentId = decodeImmutableRecordReference(sourceLocation).segmentId;
  const oldFile = store.objects.segments.segmentPath(oldSegmentId);
  const reader = await acquireImmutableReaderRetention(store, async () => {});
  const sources = [];
  for await (const [identity, location] of store.objects.locations.entries(before.locationRoot))
    if (decodeImmutableRecordReference(location).segmentId === oldSegmentId)
      sources.push({ identity, sourceLocation: location });
  assert.ok(sources.length > 1);
  const cleanup = async () => {
    const options = {
      storageService,
      sessionDir: request.sessionDir,
      assertSessionWritable: async () => {},
    };
    const plan = await prepareSessionArtifactCleanup({ ...options, dryRun: false });
    try {
      while (
        !(
          await cleanupSessionArtifacts({
            ...options,
            planId: plan.planId,
            maxCandidates: 1,
            maxRemovals: 1,
          })
        ).complete
      ) {
        continue;
      }
    } finally {
      await discardSessionArtifactCleanup({ ...options, planId: plan.planId });
    }
  };
  try {
    for (let offset = 0; offset < sources.length; offset += 8) {
      const head = await store.snapshot();
      await compactSessionArtifacts({
        ...request,
        expectedGeneration: head.generation,
        operationId: `evacuate-${offset}`,
        records: sources.slice(offset, offset + 8),
      });
    }
    const current = await store.snapshot();
    for await (const physical of store.objects.physicalReferences(current))
      assert.notEqual(decodeImmutableRecordReference(physical).segmentId, oldSegmentId);
    await cleanup();
    await access(oldFile);
    assert.deepEqual(await store.get(reader.head, "metadata", "item"), { kept: true });
    assert.deepEqual(await store.get(current, "metadata", "item"), { kept: true });
  } finally {
    await reader.release();
  }
  await cleanup();
  await assert.rejects(access(oldFile), { code: "ENOENT" });
  assert.equal((await auditImmutableSession({ sessionDir: request.sessionDir })).ok, true);
});

test("compaction validates request and source budgets before storage I/O", async () => {
  const invalid = {
    storageService,
    sessionDir: "/nonexistent",
    expectedGeneration: 1,
    operationId: "invalid",
    assertSessionWritable: async () => {
      throw new Error("unexpected lock");
    },
    records: [],
  };
  await assert.rejects(compactSessionArtifacts(invalid), /bounded non-empty/);
  await assert.rejects(
    compactSessionArtifacts({ ...invalid, bypass: true }),
    /Unknown immutable compaction/,
  );
});
