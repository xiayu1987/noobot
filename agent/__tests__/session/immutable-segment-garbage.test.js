/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { immutableOwnedInventory } from "../../src/session/session-artifact-session/immutable-object-garbage.js";
import { capturedImmutableCandidates } from "../helpers/immutable-cleanup-candidates.js";
import {
  IMMUTABLE_LOCATED_SESSION_FORMAT as FORMAT,
  IMMUTABLE_SEGMENT_SESSION_FORMAT,
  immutablePublicationTemporaryFile,
  requireImmutableCleanupCandidate,
  requireImmutableCleanupChunk,
  requireImmutableCleanupCursorChunk,
  requireImmutableCleanupManifest,
  IMMUTABLE_CLEANUP_PLAN,
} from "@noobot/session-protocol/immutable-storage";
import {
  decodeImmutableRecordReference,
  immutableSegmentFileName,
} from "@noobot/session-protocol/immutable-segment";

const token = "00000000-0000-0000-0000-000000000001";

async function fixture(t, items = 1) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-segment-garbage-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "segment", allowCreate: true });
  await store.commit({
    expectedGeneration: 0,
    operationId: "seed",
    changes: Array.from({ length: items }, (_, i) => ({
      collection: "metadata",
      key: `item:${i}`,
      value: { i },
    })),
  });
  return { sessionDir, store, segments: store.objects.segments, head: await store.snapshot() };
}

async function abandoned(segments, text) {
  const batch = segments.createBatch();
  const reference = batch.stage(Buffer.from(text));
  await batch.publish([reference]);
  return reference;
}

function segmentFile(reference) {
  return `segments/${immutableSegmentFileName(decodeImmutableRecordReference(reference).segmentId)}`;
}

function candidates({ sessionDir, store, head }, { signal, retainedHeads = [head] } = {}) {
  return Array.fromAsync(
    capturedImmutableCandidates({
      sessionDir,
      retainedHeads,
      retentionDirectory: path.join(sessionDir, "retention-test"),
      objects: store.objects,
      signal,
      format: FORMAT,
      inventory: immutableOwnedInventory({ sessionDir, format: FORMAT, signal }),
    }),
  );
}

test("committed segments are retained through locator roots; wholly unreachable segments are candidates", async (t) => {
  const context = await fixture(t);
  const garbage = await abandoned(context.segments, "unreachable transaction");
  let retainedSegments = null;
  const files = await Array.fromAsync(
    capturedImmutableCandidates({
      sessionDir: context.sessionDir,
      retainedHeads: [context.head],
      retentionDirectory: path.join(context.sessionDir, "retention-test"),
      objects: context.store.objects,
      format: FORMAT,
      inventory: immutableOwnedInventory({ sessionDir: context.sessionDir, format: FORMAT }),
      onRetainedSegments: (count) => {
        retainedSegments = count;
      },
    }),
  );
  assert.deepEqual(files, [segmentFile(garbage)]);
  assert.ok(retainedSegments >= 1);
  for (const file of files) await unlink(path.join(context.sessionDir, file));
  await assert.rejects(context.segments.read(garbage), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  const reopened = await ImmutableSessionStore.open({ sessionDir: context.sessionDir });
  assert.deepEqual(await reopened.get(context.head, "metadata", "item:0"), { i: 0 });
  assert.deepEqual(await candidates(context), []);
});

test("segment inventory admits only protocol-owned files and leaves foreign names untouched", async (t) => {
  const context = await fixture(t);
  const { sessionDir, segments, head } = context;
  const liveFile = segments.segmentPath(head.segmentTail.segmentId);
  const temporary = immutablePublicationTemporaryFile(liveFile, token);
  await writeFile(temporary, "incomplete publication");
  await writeFile(path.join(segments.directory, "foreign.tmp"), "keep");
  await writeFile(path.join(segments.directory, `${"b".repeat(32)}.seg.tmp`), "keep");
  await mkdir(path.join(segments.directory, `${"c".repeat(32)}.seg`));
  await symlink(liveFile, path.join(segments.directory, `${"d".repeat(32)}.seg`));
  await mkdir(path.join(sessionDir, "objects", "aa"), { recursive: true });
  await writeFile(path.join(sessionDir, "objects", "aa", "b".repeat(62)), "foreign");
  const headTemporary = immutablePublicationTemporaryFile("head.json", token);
  await writeFile(path.join(sessionDir, headTemporary), "incomplete head");
  const files = await candidates(context);
  assert.deepEqual(files.sort(), [`segments/${path.basename(temporary)}`, headTemporary].sort());
  for (const file of files) assert.equal(requireImmutableCleanupCandidate(file, FORMAT), file);
});

test("segment cleanup pages bind paths to the located head format", async (t) => {
  const { head } = await fixture(t);
  const file = `segments/${immutableSegmentFileName("a".repeat(32))}`;
  const plan = {
    format: IMMUTABLE_CLEANUP_PLAN.format,
    id: token,
    dryRun: false,
    firstChunk: "c".repeat(64),
    candidates: 1,
    retainedSegments: 1,
    head,
  };
  assert.equal(requireImmutableCleanupManifest(plan, token), plan);
  const chunk = { previous: null, files: [file] };
  assert.equal(requireImmutableCleanupCursorChunk(chunk, { processed: 0, offset: 0 }, plan), chunk);
  assert.equal(requireImmutableCleanupChunk(chunk, FORMAT), chunk);
  for (const invalid of [
    file.replace("segments/", "segments/../"),
    file.toUpperCase(),
    `${file}.tmp`,
    `objects/aa/${"b".repeat(62)}`,
    "head.json",
    "/" + file,
  ])
    assert.throws(() => requireImmutableCleanupCandidate(invalid, FORMAT), {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    });
  for (const format of [IMMUTABLE_SEGMENT_SESSION_FORMAT, undefined])
    assert.throws(() => requireImmutableCleanupCandidate(file, format), {
      code: "SESSION_MAINTENANCE_MIGRATION_REQUIRED",
    });
  const { retainedSegments: _retained, ...legacy } = plan;
  assert.throws(() => requireImmutableCleanupManifest({ ...legacy, retainedObjects: 1 }, token), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  assert.throws(
    () => requireImmutableCleanupManifest({ ...plan, head: { ...head, format: "unknown" } }, token),
    { code: "SESSION_MAINTENANCE_MIGRATION_REQUIRED" },
  );
});

test("segment inventory rejects missing heads, legacy heads and missing directories without fallback", async (t) => {
  const context = await fixture(t);
  await assert.rejects(candidates(context, { retainedHeads: [] }), /explicit retained heads/);
  await assert.rejects(
    candidates(context, {
      retainedHeads: [{ ...context.head, format: IMMUTABLE_SEGMENT_SESSION_FORMAT }],
    }),
    { code: "SESSION_MAINTENANCE_MIGRATION_REQUIRED" },
  );
  const empty = await mkdtemp(path.join(tmpdir(), "immutable-segment-garbage-empty-"));
  t.after(() => rm(empty, { recursive: true, force: true }));
  await assert.rejects(
    Array.fromAsync(immutableOwnedInventory({ sessionDir: empty, format: FORMAT })),
    { code: "ENOENT" },
  );
});

for (const scope of ["references", "directory"]) {
  test(`segment ${scope} traversal yields and preserves the original cancellation reason`, async (t) => {
    const context = await fixture(t, scope === "references" ? 160 : 1);
    if (scope === "directory")
      for (let i = 0; i < 128; i++)
        await writeFile(path.join(context.segments.directory, `foreign-${i}`), "keep");
    const controller = new AbortController();
    const reason = new Error(`cancel ${scope}`);
    let checks = 0;
    t.mock.method(controller.signal, "throwIfAborted", () => {
      AbortSignal.prototype.throwIfAborted.call(controller.signal);
      if (++checks === 64) queueMicrotask(() => controller.abort(reason));
    });
    await assert.rejects(
      candidates(context, { signal: controller.signal }),
      (error) => error === reason,
    );
    assert.equal(controller.signal.aborted, true);
  });
}
