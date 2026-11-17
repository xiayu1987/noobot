/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { IMMUTABLE_CLEANUP_PLAN as PLAN } from "@noobot/session-protocol/immutable-storage";
import { decodeImmutableRecordReference } from "@noobot/session-protocol/immutable-segment";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { ImmutableCleanupRetention } from "../../src/session/session-artifact-session/immutable-cleanup-retention.js";
import { advanceImmutableCleanupMarking } from "../../src/session/session-artifact-session/immutable-cleanup-marking.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "cleanup-marking-recovery-"));
  t.after(async () => {
    resetFsAdapter();
    await rm(directory, { recursive: true, force: true });
  });
  const sessionDir = path.join(directory, "session");
  const retentionDirectory = path.join(directory, "retention");
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "marking", allowCreate: true });
  await store.commit({
    expectedGeneration: 0,
    operationId: "seed",
    changes: Array.from({ length: 220 }, (_, index) => ({
      collection: "metadata",
      key: `key-${index}`,
      value: `value-${index}`,
    })),
  });
  return { directory, sessionDir, retentionDirectory, store, head: await store.snapshot() };
}

async function expectedSegments(store, heads) {
  const segments = new Set();
  for (const head of heads) {
    if (head.segmentTail !== null) segments.add(head.segmentTail.segmentId);
    for await (const reference of store.objects.physicalReferences(head))
      segments.add(decodeImmutableRecordReference(reference).segmentId);
  }
  return segments;
}

test("one-page marking resumes across fresh owners and matches the complete physical root set", async (t) => {
  const { sessionDir, retentionDirectory, store, head } = await fixture(t);
  await store.commit({
    expectedGeneration: head.generation,
    operationId: "next",
    changes: [{ collection: "metadata", key: "new", value: "new" }],
  });
  const heads = [head, await store.snapshot()];
  const expected = await expectedSegments(store, heads);
  let complete = false;
  let batches = 0;
  while (!complete) {
    assert.ok(++batches < 500, "marking must finish without rewalking the consumed prefix");
    const reopened = await ImmutableSessionStore.open({ sessionDir });
    const retention = new ImmutableCleanupRetention(retentionDirectory, { create: batches === 1 });
    const result = await advanceImmutableCleanupMarking({
      retainedHeads: heads,
      objects: reopened.objects,
      retention,
      maxPages: 1,
    });
    assert.equal(result.scannedPages, 1);
    assert.ok(result.seekPageReads <= 64);
    complete = result.complete;
  }
  assert.ok(batches > 2, "fixture must cross multiple location pages and roots");
  const final = new ImmutableCleanupRetention(retentionDirectory);
  await final.load();
  assert.equal(final.size, expected.size);
  for (const segment of expected) assert.equal(await final.has(segment), true);
  assert.equal(final.mark.rootIndex, heads.length);
  const done = await advanceImmutableCleanupMarking({
    retainedHeads: heads,
    objects: store.objects,
    retention: final,
    maxPages: 1,
  });
  assert.equal(done.complete, true);
  assert.equal(done.scannedPages, 0);
  assert.equal(done.seekPageReads, 0);
});

test("a different captured root set cannot reuse a marking checkpoint", async (t) => {
  const { retentionDirectory, store, head } = await fixture(t);
  const retention = new ImmutableCleanupRetention(retentionDirectory, { create: true });
  const first = await advanceImmutableCleanupMarking({
    retainedHeads: [head],
    objects: store.objects,
    retention,
    maxPages: 1,
  });
  assert.equal(first.complete, false);
  const file = path.join(retentionDirectory, PLAN.retentionState);
  const before = await readFile(file);
  await store.commit({
    expectedGeneration: head.generation,
    operationId: "next",
    changes: [{ collection: "metadata", key: "new", value: "new" }],
  });
  await assert.rejects(
    advanceImmutableCleanupMarking({
      retainedHeads: [await store.snapshot()],
      objects: store.objects,
      retention: new ImmutableCleanupRetention(retentionDirectory),
      maxPages: 1,
    }),
    { code: "SESSION_IMMUTABLE_STORAGE_INVALID" },
  );
  assert.deepEqual(await readFile(file), before);
});

for (const failureKind of ["cancel", "read"]) {
  test(`${failureKind} during a marking batch preserves the committed cursor and can resume`, async (t) => {
    const { retentionDirectory, store, head } = await fixture(t);
    const retention = new ImmutableCleanupRetention(retentionDirectory, { create: true });
    await advanceImmutableCleanupMarking({
      retainedHeads: [head],
      objects: store.objects,
      retention,
      maxPages: 1,
    });
    const file = path.join(retentionDirectory, PLAN.retentionState);
    const before = await readFile(file);
    const failure = new Error(`marking ${failureKind}`);
    const controller = new AbortController();
    const original = store.objects.locations.readPage.bind(store.objects.locations);
    let reads = 0;
    store.objects.locations.readPage = async (...args) => {
      const page = await original(...args);
      if (++reads === 2) {
        if (failureKind === "cancel") controller.abort(failure);
        else throw failure;
      }
      return page;
    };
    try {
      await assert.rejects(
        advanceImmutableCleanupMarking({
          retainedHeads: [head],
          objects: store.objects,
          retention: new ImmutableCleanupRetention(retentionDirectory),
          maxPages: 3,
          signal: controller.signal,
        }),
        (error) => error === failure,
      );
    } finally {
      store.objects.locations.readPage = original;
    }
    assert.ok(reads >= 2);
    assert.deepEqual(await readFile(file), before);
    const resumed = await advanceImmutableCleanupMarking({
      retainedHeads: [head],
      objects: store.objects,
      retention: new ImmutableCleanupRetention(retentionDirectory),
      maxPages: 1,
    });
    assert.equal(resumed.scannedPages, 1);
    assert.notDeepEqual(await readFile(file), before);
  });
}

test("checkpoint publication failure does not make an uncommitted marking cursor authoritative", async (t) => {
  const { retentionDirectory, store, head } = await fixture(t);
  const retention = new ImmutableCleanupRetention(retentionDirectory, { create: true });
  await advanceImmutableCleanupMarking({
    retainedHeads: [head],
    objects: store.objects,
    retention,
    maxPages: 1,
  });
  const file = path.join(retentionDirectory, PLAN.retentionState);
  const before = await readFile(file);
  const failure = new Error("checkpoint temporary file open failed");
  setFsAdapter({
    open: async (target, flags, ...args) => {
      if (target.startsWith(file + ".") && flags === "wx") throw failure;
      return open(target, flags, ...args);
    },
  });
  try {
    await assert.rejects(
      advanceImmutableCleanupMarking({
        retainedHeads: [head],
        objects: store.objects,
        retention,
        maxPages: 1,
      }),
      (error) => error === failure,
    );
  } finally {
    resetFsAdapter();
  }
  assert.deepEqual(await readFile(file), before);
  const resumed = await advanceImmutableCleanupMarking({
    retainedHeads: [head],
    objects: store.objects,
    retention: new ImmutableCleanupRetention(retentionDirectory),
    maxPages: 1,
  });
  assert.equal(resumed.scannedPages, 1);
  assert.notDeepEqual(await readFile(file), before);
});

test("a child process continues a persisted marking cursor without an in-memory iterator", async (t) => {
  const { sessionDir, retentionDirectory, store, head } = await fixture(t);
  await advanceImmutableCleanupMarking({
    retainedHeads: [head],
    objects: store.objects,
    retention: new ImmutableCleanupRetention(retentionDirectory, { create: true }),
    maxPages: 1,
  });
  const file = path.join(retentionDirectory, PLAN.retentionState);
  const before = await readFile(file);
  const moduleUrl = (name) =>
    new URL(`../../src/session/session-artifact-session/${name}.js`, import.meta.url).href;
  const script = `
    import { ImmutableSessionStore } from ${JSON.stringify(moduleUrl("immutable-session-store"))};
    import { ImmutableCleanupRetention } from ${JSON.stringify(moduleUrl("immutable-cleanup-retention"))};
    import { advanceImmutableCleanupMarking } from ${JSON.stringify(moduleUrl("immutable-cleanup-marking"))};
    const store = await ImmutableSessionStore.open({sessionDir: process.argv[1]});
    const result = await advanceImmutableCleanupMarking({
      retainedHeads: [JSON.parse(process.argv[3])], objects: store.objects,
      retention: new ImmutableCleanupRetention(process.argv[2]), maxPages: 1
    });
    process.stdout.write(JSON.stringify(result));
  `;
  const { stdout } = await promisify(execFile)(process.execPath, [
    "--import",
    new URL("../../../shared/testing/runtime-params.js", import.meta.url).href,
    "--input-type=module",
    "-e",
    script,
    sessionDir,
    retentionDirectory,
    JSON.stringify(head),
  ]);
  assert.equal(JSON.parse(stdout).scannedPages, 1);
  assert.notDeepEqual(await readFile(file), before);
});
