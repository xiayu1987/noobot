/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { auditImmutableSnapshot } from "../../src/session/session-artifact-session/immutable-session-audit.js";
import { immutableOwnedInventory } from "../../src/session/session-artifact-session/immutable-object-garbage.js";
import { capturedImmutableCandidates } from "../helpers/immutable-cleanup-candidates.js";
import { ImmutableCleanupChunkWriter } from "../../src/session/session-artifact-session/immutable-cleanup-chunks.js";
import { encodeImmutableSessionHead } from "@noobot/session-protocol/immutable-storage";
import { IMMUTABLE_SEGMENT } from "@noobot/session-protocol/immutable-segment";

async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-append-safety-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "safety", allowCreate: true });
  await store.commit({
    expectedGeneration: 0,
    operationId: "seed",
    changes: [{ collection: "messages", key: "m", value: "committed" }],
  });
  return { store, head: await store.snapshot() };
}

async function detachedTail(store, head, segmentId) {
  const bytes = Buffer.from(IMMUTABLE_SEGMENT.magic + "unreferenced committed allocation");
  await writeFile(store.objects.segments.segmentPath(segmentId), bytes);
  return { ...head, segmentTail: { segmentId, end: bytes.length } };
}

test("inventory preserves current and retained append tails even without a record reference", async (t) => {
  const { store, head } = await fixture(t);
  const current = await detachedTail(store, head, "a".repeat(32));
  const retained = await detachedTail(store, head, "b".repeat(32));
  await detachedTail(store, head, "c".repeat(32));
  const options = {
    sessionDir: store.sessionDir,
    format: head.format,
    retainedHeads: [current, retained],
    retentionDirectory: path.join(store.sessionDir, "retention-test"),
    objects: store.objects,
  };
  options.inventory = immutableOwnedInventory(options);
  const candidates = await Array.fromAsync(capturedImmutableCandidates(options));
  for (const id of ["a", "b"])
    assert.equal(candidates.includes(`segments/${id.repeat(32)}.seg`), false);
  assert.equal(candidates.includes(`segments/${"c".repeat(32)}.seg`), true);
  const { retainedHeads: _heads, ...missing } = options;
  await assert.rejects(
    Array.fromAsync(capturedImmutableCandidates(missing)),
    /explicit retained heads/,
  );
  await assert.rejects(
    new ImmutableCleanupChunkWriter(
      path.join(store.sessionDir, "missing-inventory"),
      head.format,
    ).write(undefined),
    TypeError,
  );
});

for (const state of ["missing", "truncated"]) {
  test(`audit rejects a ${state} active tail even when all graph records remain readable`, async (t) => {
    const { store, head } = await fixture(t);
    const active = await detachedTail(store, head, "d".repeat(32));
    const file = store.objects.segments.segmentPath(active.segmentTail.segmentId);
    if (state === "missing") await rm(file);
    else await writeFile(file, IMMUTABLE_SEGMENT.magic);
    await writeFile(store.headPath, encodeImmutableSessionHead(active, active.format));
    assert.equal(await store.get(active, "messages", "m"), "committed");
    const report = await auditImmutableSnapshot({ store, snapshot: active });
    assert.equal(report.ok, false);
    assert.equal(report.issues[0].code, "SESSION_IMMUTABLE_STORAGE_INVALID");
  });
}

test("audit accepts and leaves unpublished suffixes untouched", async (t) => {
  const { store, head } = await fixture(t);
  const file = store.objects.segments.segmentPath(head.segmentTail.segmentId);
  await writeFile(file, "uncommitted suffix", { flag: "a" });
  const before = (await stat(file)).size;
  const report = await auditImmutableSnapshot({ store, snapshot: head });
  assert.equal(report.ok, true, JSON.stringify(report.issues));
  assert.equal((await stat(file)).size, before);
});
