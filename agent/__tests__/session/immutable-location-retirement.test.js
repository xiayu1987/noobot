/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile, rename, readdir, writeFile, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { ImmutableLocationRetirement } from "../../src/session/session-artifact-session/immutable-location-retirement.js";
import {
  retireSessionArtifactLocations,
  discardSessionArtifactLocationRetirement,
  compactSessionArtifacts,
  cleanupSessionArtifacts,
  discardSessionArtifactCleanup,
} from "../../src/session/index.js";
import { acquireImmutableReaderRetention } from "../../src/session/session-artifact-session/immutable-reader-retention.js";
import { auditImmutableSession } from "../../src/session/session-artifact-session/immutable-session-audit.js";
import { TEST_STORAGE_SERVICE as storageService } from "../helpers/storage-service.js";
import { prepareSessionArtifactCleanupToCompletion as prepareSessionArtifactCleanup } from "../helpers/immutable-cleanup.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { IMMUTABLE_LOCATION_RETIREMENT as PROOF } from "@noobot/session-protocol/immutable-record-location";
import {
  encodeImmutableCleanupRecord,
  decodeImmutableCleanupBytes,
} from "@noobot/session-protocol/immutable-storage";
import { decodeImmutableRecordReference } from "@noobot/session-protocol/immutable-segment";

test("wide proof queues resume without rewriting consumed task pages", async (t) => {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "retirement-queue-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const tasks = Array.from({ length: PROOF.tasksPerPage * 8 + 1 }, (_, i) => ({
    kind: "raw",
    reference: i.toString(16).padStart(64, "0"),
    bytes: 1,
  }));
  let state = { queue: null, queueOffset: 0, segmentTail: null };
  let writtenTasks = 0;
  let writtenPages = 0;
  const create = () => {
    const proof = new ImmutableLocationRetirement({ sessionDir }, { records: [] });
    const putValue = proof.pages.putValue.bind(proof.pages);
    proof.pages.putValue = (value) => {
      assert.ok(value.tasks.length <= PROOF.tasksPerPage);
      writtenTasks += value.tasks.length;
      writtenPages += 1;
      return putValue(value);
    };
    return proof;
  };
  const initial = create();
  await initial.pages.withDurabilityBatch(async () => {
    initial.pages.beginCommit(state);
    await initial.enqueue(state, tasks);
    await initial.pages.publishReachable([state.queue]);
    Object.assign(state, initial.pages.publicationHeadFields());
  });
  const checkpoint = path.join(sessionDir, "queue-checkpoint.json");
  await writeFile(checkpoint, JSON.stringify(state));
  const actual = [];
  while (state.queue !== null) {
    state = JSON.parse(await readFile(checkpoint, "utf8"));
    const reopened = create();
    await reopened.pages.withDurabilityBatch(async () => {
      reopened.pages.beginCommit(state);
      for (let step = 0; step < 7 && state.queue !== null; step += 1)
        actual.push(await reopened.pop(state));
      await reopened.pages.publishReachable([state.queue]);
      Object.assign(state, reopened.pages.publicationHeadFields());
    });
    await writeFile(checkpoint, JSON.stringify(state));
  }
  assert.deepEqual(actual, tasks.toReversed());
  assert.equal(writtenTasks, tasks.length);
  assert.equal(writtenPages, Math.ceil(tasks.length / PROOF.tasksPerPage));
  assert.equal(state.queueOffset, 0);
});

test("nested proof queues preserve partial parent cursors across cold recovery", async (t) => {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "retirement-parent-cursor-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const tasks = Array.from({ length: 5 }, (_, i) => ({
    kind: "raw",
    reference: i.toString(16).padStart(64, "0"),
    bytes: 1,
  }));
  let state = { queue: null, queueOffset: 0, segmentTail: null };
  const initial = new ImmutableLocationRetirement({ sessionDir }, { records: [] });
  await initial.pages.withDurabilityBatch(async () => {
    initial.pages.beginCommit(state);
    await initial.enqueue(state, tasks.slice(0, 3));
    assert.deepEqual(await initial.pop(state), tasks[2]);
    assert.equal(state.queueOffset, 1);
    await initial.enqueue(state, tasks.slice(3));
    await initial.pages.publishReachable([state.queue]);
    Object.assign(state, initial.pages.publicationHeadFields());
  });
  state = JSON.parse(JSON.stringify(state));
  const reopened = new ImmutableLocationRetirement({ sessionDir }, { records: [] });
  const actual = [];
  await reopened.pages.withDurabilityBatch(async () => {
    reopened.pages.beginCommit(state);
    while (state.queue !== null) actual.push(await reopened.pop(state));
  });
  assert.deepEqual(actual, [tasks[4], tasks[3], tasks[1], tasks[0]]);
  assert.equal(state.queueOffset, 0);
});

async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "location-retirement-"));
  let retention = null;
  t.after(async () => {
    try {
      await retention?.release();
    } finally {
      await rm(sessionDir, { recursive: true, force: true });
    }
  });
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "retire", allowCreate: true });
  await store.commit({
    expectedGeneration: 0,
    operationId: "seed",
    changes: [{ collection: "metadata", key: "item", value: { previous: true } }],
  });
  const first = await store.snapshot();
  const oldValue = await store.objects.withSnapshot(first, async () =>
    store.index.get(await store.index.get(first.root, "metadata"), "item"),
  );
  retention = await acquireImmutableReaderRetention(store, async () => {});
  await store.commit({
    expectedGeneration: 1,
    operationId: "update",
    changes: [{ collection: "metadata", key: "item", value: { current: true } }],
  });
  const head = await store.snapshot();
  const request = {
    storageService,
    sessionDir,
    operationId: "retire-old-root",
    expectedGeneration: head.generation,
    assertSessionWritable: async () => {},
    maxTasks: 8,
    records: [
      {
        identity: first.root,
        sourceLocation: await store.objects.locations.get(head.locationRoot, first.root),
      },
    ],
  };
  return { store, first, retention, oldValue, request };
}

async function finish(request) {
  for (let n = 0; n < 300; n += 1) {
    const result = await retireSessionArtifactLocations(request);
    if (result.complete) return result;
    assert.ok(result.processedTasks > 0 && result.processedTasks <= request.maxTasks);
  }
  assert.fail("retirement did not converge within the fixture work bound");
}

test("retirement, evacuation and cleanup preserve pinned bytes until reader release", async (t) => {
  const { store, first, retention, request } = await fixture(t);
  const segmentId = decodeImmutableRecordReference(request.records[0].sourceLocation).segmentId;
  const oldFile = store.objects.segments.segmentPath(segmentId);
  const body = Array.from(
    { length: 80 },
    (_, i) => `${i}:` + String.fromCharCode(33 + i).repeat(65536),
  ).join("");
  await store.commit({
    expectedGeneration: 2,
    operationId: "rollover",
    changes: [{ collection: "metadata", key: "large", value: body }],
  });
  assert.notEqual((await store.snapshot()).segmentTail.segmentId, segmentId);
  const attempt = { ...request, expectedGeneration: 3, maxTasks: 128 };
  await finish(attempt);
  await discardSessionArtifactLocationRetirement(attempt);
  const current = await store.snapshot();
  assert.equal(await store.objects.locations.get(current.locationRoot, first.root), null);
  const sources = [];
  for await (const [identity, sourceLocation] of store.objects.locations.entries(
    current.locationRoot,
  ))
    if (decodeImmutableRecordReference(sourceLocation).segmentId === segmentId)
      sources.push({ identity, sourceLocation });
  for (let offset = 0; offset < sources.length; offset += 8)
    await compactSessionArtifacts({
      storageService,
      sessionDir: request.sessionDir,
      assertSessionWritable: request.assertSessionWritable,
      expectedGeneration: (await store.snapshot()).generation,
      operationId: `evacuate-retired-${offset}`,
      records: sources.slice(offset, offset + 8),
    });
  const cleanup = async () => {
    const options = {
      storageService,
      sessionDir: request.sessionDir,
      assertSessionWritable: request.assertSessionWritable,
    };
    const plan = await prepareSessionArtifactCleanup({ ...options, dryRun: false });
    try {
      let complete = false;
      for (let step = 0; step <= plan.candidates && !complete; step += 1)
        ({ complete } = await cleanupSessionArtifacts({
          ...options,
          planId: plan.planId,
          maxCandidates: 1,
          maxRemovals: 1,
        }));
      assert.equal(complete, true);
    } finally {
      await discardSessionArtifactCleanup({ ...options, planId: plan.planId });
    }
  };
  await cleanup();
  await readFile(oldFile);
  assert.deepEqual(await store.get(retention.head, "metadata", "item"), { previous: true });
  await retention.release();
  await cleanup();
  await assert.rejects(readFile(oldFile), { code: "ENOENT" });
  const reopened = await ImmutableSessionStore.open({ sessionDir: request.sessionDir });
  assert.deepEqual(await reopened.get(await reopened.snapshot(), "metadata", "item"), {
    current: true,
  });
  assert.equal((await retireSessionArtifactLocations(attempt)).replayed, true);
  assert.equal((await auditImmutableSession({ sessionDir: request.sessionDir })).ok, true);
});

test("retirement resumes on disk, follows newer roots and preserves old readers and permanent replay", async (t) => {
  const { store, first, retention, request } = await fixture(t);
  const firstStep = await retireSessionArtifactLocations({ ...request, maxTasks: 1 });
  assert.equal(firstStep.complete, false);
  assert.equal(firstStep.processedTasks, 1);
  const head = await store.snapshot();
  await store.commit({
    expectedGeneration: head.generation,
    operationId: "during-proof",
    changes: [{ collection: "metadata", key: "new", value: "concurrent" }],
  });
  const result = await finish(request);
  assert.equal(result.complete, true);
  assert.equal(result.generation, head.generation + 2);
  assert.deepEqual(result.result, { retiredRecords: 1 });
  const reopened = await ImmutableSessionStore.open({ sessionDir: request.sessionDir });
  const current = await reopened.snapshot();
  assert.equal(await reopened.objects.locations.get(current.locationRoot, first.root), null);
  assert.deepEqual(await reopened.get(retention.head, "metadata", "item"), { previous: true });
  assert.equal(await reopened.get(current, "metadata", "new"), "concurrent");
  assert.equal((await auditImmutableSession({ sessionDir: request.sessionDir })).ok, true);
  await discardSessionArtifactLocationRetirement(request);
  const bytes = await readFile(store.headPath);
  assert.equal((await retireSessionArtifactLocations(request)).replayed, true);
  assert.deepEqual(await readFile(store.headPath), bytes);
  await assert.rejects(retireSessionArtifactLocations({ ...request, expectedGeneration: 1 }), {
    code: "SESSION_OPERATION_CONFLICT",
  });
});

test("a fresh process resumes the durable proof and preserves pinned readers and replay", async (t) => {
  const { store, retention, first, request } = await fixture(t);
  assert.equal((await retireSessionArtifactLocations({ ...request, maxTasks: 1 })).complete, false);
  const source = `
    import { retireSessionArtifactLocations } from ${JSON.stringify(new URL("../../src/session/session-artifact-maintenance.js", import.meta.url).href)};
    import { TEST_STORAGE_SERVICE as storageService } from ${JSON.stringify(new URL("../helpers/storage-service.js", import.meta.url).href)};
    const request = { ...JSON.parse(process.argv[1]), storageService, assertSessionWritable: async () => {} };
    for (let step = 0; step < 300; step += 1) {
      const result = await retireSessionArtifactLocations(request);
      if (result.complete) {
        process.stdout.write(JSON.stringify(result));
        break;
      }
      if (step === 299) throw new Error("Proof did not converge");
    }
  `;
  const { storageService: _service, assertSessionWritable: _writable, ...portable } = request;
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--import",
      new URL("../../../shared/testing/runtime-params.js", import.meta.url).href,
      "--input-type=module",
      "--eval",
      source,
      JSON.stringify(portable),
    ],
    { timeout: 15000 },
  );
  assert.equal(JSON.parse(stdout).complete, true);
  const current = await store.snapshot();
  assert.equal(await store.objects.locations.get(current.locationRoot, first.root), null);
  assert.deepEqual(await store.get(retention.head, "metadata", "item"), { previous: true });
  assert.equal((await retireSessionArtifactLocations(request)).replayed, true);
  assert.equal((await auditImmutableSession({ sessionDir: request.sessionDir })).ok, true);
});

test("history values, current roots and receipts cannot be retired", async (t) => {
  const { store, oldValue, request } = await fixture(t);
  const head = await store.snapshot();
  const receipt = await store.objects.withSnapshot(head, () =>
    store.index.get(head.operations, "seed"),
  );
  const bytes = await readFile(store.headPath);
  for (const identity of [oldValue, head.root, receipt, head.commit]) {
    const attempt = {
      ...request,
      records: [
        {
          identity,
          sourceLocation: await store.objects.locations.get(head.locationRoot, identity),
        },
      ],
    };
    await assert.rejects(finish(attempt), { code: "SESSION_RECORD_STILL_REACHABLE", identity });
    await discardSessionArtifactLocationRetirement(attempt);
    assert.deepEqual(await readFile(store.headPath), bytes);
  }
});

for (const published of [false, true]) {
  test(`retirement recovers a ${published ? "published" : "unpublished"} uncertain head`, async (t) => {
    const { store, request } = await fixture(t);
    const failure = new Error("retirement acknowledgement lost");
    setFsAdapter({
      rename: async (source, target) => {
        if (target !== store.headPath) return rename(source, target);
        if (published) await rename(source, target);
        throw failure;
      },
    });
    try {
      await assert.rejects(finish(request), { code: "SESSION_COMMIT_UNCERTAIN", cause: failure });
    } finally {
      resetFsAdapter();
    }
    const result = await finish(request);
    assert.equal(result.replayed, published);
    assert.equal((await auditImmutableSession({ sessionDir: request.sessionDir })).ok, true);
  });
}

test("newly referenced candidates are rejected without discarding completed marking work", async (t) => {
  const { store, request, first } = await fixture(t);
  await retireSessionArtifactLocations({ ...request, maxTasks: 1 });

  await store.commit({
    expectedGeneration: 2,
    operationId: "reuse-root",
    changes: [{ collection: "dialogTurns", key: "owner", value: { root: first.root, count: 1 } }],
  });
  await assert.rejects(finish(request), {
    code: "SESSION_RECORD_STILL_REACHABLE",
    identity: first.root,
  });
  assert.notEqual(
    await store.objects.locations.get((await store.snapshot()).locationRoot, first.root),
    null,
  );
});

test("proof ownership, cancellation, malformed requests and writability fail explicitly", async (t) => {
  const { store, request } = await fixture(t);
  await retireSessionArtifactLocations({ ...request, maxTasks: 1 });
  await assert.rejects(retireSessionArtifactLocations({ ...request, operationId: "other" }), {
    code: "SESSION_RETIREMENT_BUSY",
  });
  const reason = new Error("cancelled");
  const controller = new AbortController();
  controller.abort(reason);
  await assert.rejects(
    retireSessionArtifactLocations({ ...request, signal: controller.signal }),
    (error) => error === reason,
  );
  await assert.rejects(
    retireSessionArtifactLocations({
      ...request,
      assertSessionWritable: async () => {
        throw reason;
      },
    }),
    (error) => error === reason,
  );
  for (const maxTasks of [0, 129, NaN])
    await assert.rejects(retireSessionArtifactLocations({ ...request, maxTasks }), /task budget/);
  await assert.rejects(retireSessionArtifactLocations({ ...request, bypass: true }), /Unknown/);
  assert.equal((await store.snapshot()).generation, 2);
  await discardSessionArtifactLocationRetirement(request);
  assert.equal((await finish(request)).complete, true);
});

for (const published of [false, true]) {
  test(`proof cursor survives ${published ? "replaced" : "unreplaced"} state publication failure`, async (t) => {
    const { store, request } = await fixture(t);
    await retireSessionArtifactLocations({ ...request, maxTasks: 1 });
    const stateFile = path.join(request.sessionDir, PROOF.directory, PROOF.state);
    const failure = new Error("proof cursor sync failed");
    setFsAdapter({
      rename: async (source, target) => {
        if (target !== stateFile) return rename(source, target);
        if (published) await rename(source, target);
        throw failure;
      },
    });
    try {
      await assert.rejects(
        retireSessionArtifactLocations({ ...request, maxTasks: 1 }),
        (error) => error === failure,
      );
    } finally {
      resetFsAdapter();
    }
    assert.equal((await finish(request)).complete, true);
    assert.equal((await store.snapshot()).generation, 3);
  });
}

test("proof capacity includes orphan files and disposal releases every temporary file", async (t) => {
  const { store, request } = await fixture(t);
  await retireSessionArtifactLocations({ ...request, maxTasks: 1 });
  const directory = path.join(request.sessionDir, PROOF.directory);
  const segments = path.join(directory, "segments");
  const actual = await readdir(segments);
  assert.equal(
    actual.length,
    1,
    "steps append to shared segments instead of creating object files",
  );
  for (let i = 1; i <= PROOF.proofSegments; i += 1)
    await writeFile(path.join(segments, `${i.toString(16).padStart(32, "0")}.seg`), "orphan");
  const headBytes = await readFile(store.headPath);
  const stateFile = path.join(directory, PROOF.state);
  const proofBytes = await readFile(stateFile);
  const proof = new ImmutableLocationRetirement(store, request);
  proof.children = () => assert.fail("capacity must reject before graph traversal");
  await assert.rejects(proof.run(), { code: "SESSION_RETIREMENT_CAPACITY_EXCEEDED" });
  assert.deepEqual(await readFile(stateFile), proofBytes);
  await assert.rejects(retireSessionArtifactLocations(request), {
    code: "SESSION_RETIREMENT_CAPACITY_EXCEEDED",
  });
  assert.deepEqual(await readFile(store.headPath), headBytes);
  await discardSessionArtifactLocationRetirement(request);
  await assert.rejects(readdir(directory), { code: "ENOENT" });
  await discardSessionArtifactLocationRetirement(request);
  assert.equal((await finish(request)).complete, true);
});

test("a changed source cannot be retired using old proof evidence", async (t) => {
  const { store, request } = await fixture(t);
  await retireSessionArtifactLocations({ ...request, maxTasks: 1 });
  await store.transact({
    expectedGeneration: 2,
    operationId: "move-source",
    input: {},
    prepare: async () => {
      await store.objects.relocate(request.records[0]);
      return { changes: [], result: null };
    },
  });
  const bytes = await readFile(store.headPath);
  await assert.rejects(finish(request), { code: "SESSION_RELOCATION_SOURCE_CHANGED" });
  assert.deepEqual(await readFile(store.headPath), bytes);
});

test("oversized reference metadata reports capacity instead of publishing an incomplete proof", async (t) => {
  const { store, request } = await fixture(t);
  await store.transact({
    expectedGeneration: 2,
    operationId: "large-receipt",
    input: {},
    prepare: async () => ({ changes: [], result: "x".repeat(PROOF.metadataBytes + 1) }),
  });
  const attempt = { ...request, expectedGeneration: 3 };
  const bytes = await readFile(store.headPath);
  await assert.rejects(finish(attempt), { code: "SESSION_RETIREMENT_METADATA_BUDGET_EXCEEDED" });
  assert.deepEqual(await readFile(store.headPath), bytes);
  await discardSessionArtifactLocationRetirement(attempt);
});

for (const syncFails of [false, true]) {
  test(`disposal attempts directory sync after removal failure (${syncFails ? "both fail" : "sync succeeds"})`, async (t) => {
    const { request } = await fixture(t);
    await retireSessionArtifactLocations({ ...request, maxTasks: 1 });
    const directory = path.join(request.sessionDir, PROOF.directory);
    const parent = path.dirname(directory);
    const removalFailure = new Error("partial removal failed");
    const syncFailure = new Error("parent sync failed");
    let syncs = 0;
    setFsAdapter({
      rm: async (target, options) => {
        if (target === directory) throw removalFailure;
        return rm(target, options);
      },
      open: async (target, flags) => {
        if (target !== parent) return open(target, flags);
        const handle = await open(target, flags);
        return {
          sync: async () => {
            syncs += 1;
            if (syncFails) throw syncFailure;
            await handle.sync();
          },
          close: () => handle.close(),
        };
      },
    });
    try {
      await assert.rejects(discardSessionArtifactLocationRetirement(request), (error) => {
        if (!syncFails) return error === removalFailure;
        assert.equal(error.cause, removalFailure);
        assert.deepEqual(error.errors, [removalFailure, syncFailure]);
        return true;
      });
      assert.equal(syncs, 1);
    } finally {
      resetFsAdapter();
    }
    await discardSessionArtifactLocationRetirement(request);
    await assert.rejects(readdir(directory), { code: "ENOENT" });
  });
}

test("checksummed but inconsistent proof progress cannot authorize publication", async (t) => {
  const { store, request } = await fixture(t);
  await retireSessionArtifactLocations({ ...request, maxTasks: 1 });
  const stateFile = path.join(request.sessionDir, PROOF.directory, PROOF.state);
  const state = decodeImmutableCleanupBytes(await readFile(stateFile));
  const headBytes = await readFile(store.headPath);
  for (const change of [
    { observedGeneration: 1 },
    { observedGeneration: 0 },
    { processed: 0 },
    { seen: null },
    { queueOffset: undefined },
    { queueOffset: -1 },
    { queueOffset: PROOF.tasksPerPage },
    { queueOffset: PROOF.tasksPerPage - 1 },
    { queue: null, queueOffset: 1 },
    { queue: null, publicationGeneration: state.observedGeneration + 1 },
  ]) {
    await writeFile(stateFile, encodeImmutableCleanupRecord({ ...state, ...change }));
    await assert.rejects(retireSessionArtifactLocations(request), {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    });
    assert.deepEqual(await readFile(store.headPath), headBytes);
  }
  await writeFile(stateFile, encodeImmutableCleanupRecord(state));
  assert.equal((await finish(request)).complete, true);
});

test("obsolete proofs reject execution but permit only matching-owner disposal", async (t) => {
  const { store, request } = await fixture(t);
  await retireSessionArtifactLocations({ ...request, maxTasks: 1 });
  const directory = path.join(request.sessionDir, PROOF.directory);
  const stateFile = path.join(directory, PROOF.state);
  const state = decodeImmutableCleanupBytes(await readFile(stateFile));
  const obsolete = { ...state, format: "noobot.location-retirement/1" };
  const bytes = await readFile(store.headPath);
  await writeFile(stateFile, encodeImmutableCleanupRecord(obsolete));
  await assert.rejects(retireSessionArtifactLocations(request), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  for (const [change, code] of [
    [{ sessionId: "foreign" }, "SESSION_IMMUTABLE_STORAGE_INVALID"],
    [{ operationId: "foreign" }, "SESSION_RETIREMENT_BUSY"],
    [{ expectedGeneration: 1 }, "SESSION_OPERATION_CONFLICT"],
    [{ records: [request.records[0], request.records[0]] }, undefined],
  ]) {
    await writeFile(stateFile, encodeImmutableCleanupRecord({ ...obsolete, ...change }));
    await assert.rejects(
      discardSessionArtifactLocationRetirement(request),
      code === undefined ? /Duplicate/ : { code },
    );
    await readFile(stateFile);
    assert.deepEqual(await readFile(store.headPath), bytes);
  }
  await writeFile(stateFile, encodeImmutableCleanupRecord(obsolete));
  await discardSessionArtifactLocationRetirement(request);
  await assert.rejects(readdir(directory), { code: "ENOENT" });
  assert.deepEqual(await readFile(store.headPath), bytes);
  assert.equal((await finish(request)).complete, true);
});

test("retirement traversal validates actual index and title paths", async (t) => {
  const { store, request } = await fixture(t);
  let title;
  await store.transact({
    expectedGeneration: 2,
    operationId: "title-path-fixture",
    input: {},
    prepare: async () => {
      title = await store.objects.putPage({ kind: "title-candidate", uid: "title", ordinal: 1 });
      return {
        changes: [
          { collection: "metadata", key: "titleIndex", value: { version: 1, root: title } },
        ],
        result: null,
      };
    },
  });
  const proof = new ImmutableLocationRetirement(store, request);
  const head = await store.snapshot();
  const bytes = await readFile(store.headPath);
  await store.objects.withSnapshot(head, async () => {
    const index = { kind: "index", collection: "collections", reference: head.root };
    assert.ok((await proof.children({ ...index, prefix: "" })).length > 0);
    await assert.rejects(proof.children({ ...index, prefix: "f".repeat(64) }), {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    });
    assert.deepEqual(await proof.children({ kind: "title", reference: title, prefix: "0" }), []);
    await assert.rejects(proof.children({ kind: "title", reference: title, prefix: "1" }), {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    });
  });
  assert.deepEqual(await readFile(store.headPath), bytes);
});

for (const corruption of ["branch total", "leaf length", "nested composite"]) {
  test(`retirement rejects a ${corruption} mismatch after reopening its proof`, async (t) => {
    const { store, request } = await fixture(t);
    await store.transact({
      expectedGeneration: 2,
      operationId: "malformed-byte-tree",
      input: {},
      prepare: async () => {
        const data = await store.objects.put(Buffer.alloc(32768, 32));
        const leaf = await store.objects.putPage({ kind: "value", data, bytes: 32768 });
        let reference;
        if (corruption === "leaf length") {
          reference = await store.objects.putPage({ kind: "value", data, bytes: 32767 });
        } else {
          const right =
            corruption === "nested composite"
              ? await store.objects.putPage({
                  kind: "value-parts",
                  template: leaf,
                  parts: [{ path: ["message", "content"], reference: leaf }],
                })
              : leaf;
          reference = await store.objects.putPage({
            kind: "value-branch",
            left: leaf,
            right,
            bytes: corruption === "branch total" ? 65537 : 65536,
          });
        }
        return {
          changes: [
            {
              collection: "messages",
              key: "opaque",
              value: { message: { content: null } },
              parts: [{ path: ["message", "content"], reference }],
            },
          ],
          result: null,
        };
      },
    });
    const headBytes = await readFile(store.headPath);
    const options = { ...request, expectedGeneration: 3, maxTasks: 1 };
    assert.equal((await retireSessionArtifactLocations(options)).complete, false);
    await assert.rejects(finish(options), { code: "SESSION_IMMUTABLE_STORAGE_INVALID" });
    assert.deepEqual(await readFile(store.headPath), headBytes);
  });
}
