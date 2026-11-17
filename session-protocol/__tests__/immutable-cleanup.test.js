/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import {
  IMMUTABLE_CLEANUP_PLAN as PLAN,
  IMMUTABLE_SESSION_FORMAT,
  IMMUTABLE_SEGMENT_SESSION_FORMAT,
  encodeImmutableCleanupRecord,
  decodeImmutableCleanupRecord,
  decodeImmutableCleanupBytes,
  requireImmutableCleanupRequest,
  requireImmutableCleanupManifest,
  requireImmutableCleanupProgress,
  requireImmutableCleanupCandidate,
  requireImmutableCleanupChunk,
  requireImmutableCleanupCursorChunk,
  requireImmutableCleanupHead,
  requireImmutableCleanupRetention,
} from "../src/immutable-storage.js";
import { IMMUTABLE_LOCATED_SESSION_FORMAT } from "../src/immutable-record-location.js";
import {
  IMMUTABLE_SEGMENT,
  encodeImmutableRecordReference,
  immutableSegmentFileName,
} from "../src/immutable-segment.js";

const id = "00000000-0000-0000-0000-000000000001";
const digest = "a".repeat(64);
const segmentId = "1".repeat(32);
const reference = encodeImmutableRecordReference({
  segmentId,
  offset: IMMUTABLE_SEGMENT.magic.length,
  length: 1,
  digest,
});
const plan = {
  format: PLAN.format,
  id,
  dryRun: false,
  firstChunk: digest,
  candidates: 1,
  retainedSegments: 1,
  head: {
    format: IMMUTABLE_LOCATED_SESSION_FORMAT,
    sessionId: "test",
    generation: 1,
    root: null,
    operations: digest,
    commit: digest,
    locationRoot: reference,
    segmentTail: { segmentId, end: IMMUTABLE_SEGMENT.magic.length + 1 },
  },
};

test("cleanup rejects old manifests even when their checksums are valid", () => {
  const old = decodeImmutableCleanupRecord(
    encodeImmutableCleanupRecord({ ...plan, format: "noobot.immutable-cleanup/1" }),
  );
  assert.throws(() => requireImmutableCleanupManifest(old, id), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  const { retainedSegments: _segments, ...objectCounted } = plan;
  assert.throws(
    () => requireImmutableCleanupManifest({ ...objectCounted, retainedObjects: 1 }, id),
    { code: "SESSION_IMMUTABLE_STORAGE_INVALID" },
  );
});

test("cleanup admits only sessions migrated to the located format", async () => {
  for (const format of [IMMUTABLE_SESSION_FORMAT, IMMUTABLE_SEGMENT_SESSION_FORMAT, undefined]) {
    assert.throws(() => requireImmutableCleanupCandidate("head.json." + id + ".tmp", format), {
      code: "SESSION_MAINTENANCE_MIGRATION_REQUIRED",
    });
    await assert.rejects(
      requireImmutableCleanupHead({ ...plan.head, format }, plan.head, async () => null),
      { code: "SESSION_MAINTENANCE_MIGRATION_REQUIRED" },
    );
  }
});

test("only located descendants with an explicit historical commit proof can consume an ancestor plan", async () => {
  const head = plan.head;
  const current = {
    ...head,
    generation: 2,
    commit: "b".repeat(64),
  };
  let lookups = 0;
  const proof = async (generation) => {
    assert.equal(generation, head.generation);
    lookups += 1;
    return head.commit;
  };
  await requireImmutableCleanupHead(head, { ...head }, proof);
  assert.equal(lookups, 0);
  await requireImmutableCleanupHead(head, current, proof);
  assert.equal(lookups, 1);
  for (const [candidate, readCommit] of [
    [current, undefined],
    [current, async () => null],
    [current, async () => current.commit],
    [{ ...head, root: "c".repeat(64) }, proof],
  ])
    await assert.rejects(requireImmutableCleanupHead(head, candidate, readCommit), {
      code: "SESSION_MAINTENANCE_PLAN_STALE",
    });
  await assert.rejects(requireImmutableCleanupHead(current, head, proof), {
    code: "SESSION_MAINTENANCE_PLAN_STALE",
  });
  const previousLookups = lookups;
  await assert.rejects(
    requireImmutableCleanupHead(plan.head, { ...plan.head, generation: 2 }, proof),
    { code: "SESSION_MAINTENANCE_PLAN_STALE" },
  );
  assert.equal(lookups, previousLookups);
  const failure = new Error("history proof read failed");
  await assert.rejects(
    requireImmutableCleanupHead(head, current, async () => {
      throw failure;
    }),
    (error) => error === failure,
  );
});

test("cleanup phases reject unknown fields and require explicit preparation mode and plan identity", () => {
  assert.equal(requireImmutableCleanupRequest("prepare", { dryRun: false }).dryRun, false);
  assert.equal(
    requireImmutableCleanupRequest("apply", { planId: id, maxCandidates: 1 }).planId,
    id,
  );
  assert.equal(requireImmutableCleanupRequest("discard", { planId: id }).planId, id);
  for (const phase of ["prepare", "apply", "discard"])
    assert.throws(
      () => requireImmutableCleanupRequest(phase, { maxDirectoryEntries: 1 }),
      TypeError,
    );
  assert.throws(() => requireImmutableCleanupRequest("prepare", {}), TypeError);
  assert.throws(
    () => requireImmutableCleanupRequest("apply", { planId: "../head.json" }),
    TypeError,
  );
  assert.throws(
    () => requireImmutableCleanupRequest("apply", { planId: id, dryRun: true }),
    TypeError,
  );
  assert.throws(
    () => requireImmutableCleanupRequest("discard", { planId: id, maxCandidates: 1 }),
    TypeError,
  );
  assert.throws(() => requireImmutableCleanupRequest("unknown", {}), TypeError);
});

test("cleanup records detect tampering, oversized payloads and malformed envelopes", () => {
  const bytes = encodeImmutableCleanupRecord(plan);
  assert.deepEqual(requireImmutableCleanupManifest(decodeImmutableCleanupRecord(bytes), id), plan);
  for (const raw of [
    bytes.replace("test", "other"),
    "{}",
    "null",
    "invalid",
    "x".repeat(PLAN.recordBytes + 1),
  ])
    assert.throws(() => decodeImmutableCleanupRecord(raw), {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    });
  assert.throws(() => encodeImmutableCleanupRecord({ large: "x".repeat(PLAN.recordBytes) }), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
});

test("cleanup byte decoding preserves valid Unicode and rejects invalid UTF-8, BOM and oversized input", () => {
  const record = { text: "保留-\ufffd" };
  const bytes = Buffer.from(encodeImmutableCleanupRecord(record));
  assert.deepEqual(decodeImmutableCleanupBytes(bytes), record);
  assert.deepEqual(decodeImmutableCleanupBytes(new Uint8Array(bytes)), record);
  const foreign = runInNewContext("new Uint8Array(bytes)", { bytes });
  assert.equal(foreign instanceof Uint8Array, false);
  assert.deepEqual(decodeImmutableCleanupBytes(foreign), record);
  const offset = bytes.indexOf(Buffer.from("\ufffd"));
  const damaged = Buffer.concat([
    bytes.subarray(0, offset),
    Buffer.from([0xff]),
    bytes.subarray(offset + 3),
  ]);
  for (const invalid of [
    damaged,
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]),
    Buffer.from([0xe4, 0xb8]),
    Buffer.alloc(PLAN.recordBytes + 1, 0x20),
    encodeImmutableCleanupRecord(record),
    undefined,
  ]) {
    assert.throws(() => decodeImmutableCleanupBytes(invalid), {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    });
  }
});

test("cleanup progress binds its manifest and cannot report completion before consuming all candidates", () => {
  const initial = { plan: digest, chunk: digest, offset: 0, processed: 0 };
  assert.deepEqual(requireImmutableCleanupProgress(initial, digest, plan), initial);
  for (const progress of [
    { ...initial, plan: "b".repeat(64) },
    { ...initial, offset: PLAN.chunkEntries },
    { ...initial, processed: 2 },
    { ...initial, chunk: null },
    { ...initial, processed: 1 },
    { ...initial, offset: 1 },
    { ...initial, chunk: "b".repeat(64) },
  ])
    assert.throws(() => requireImmutableCleanupProgress(progress, digest, plan), {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    });
  const complete = { ...initial, chunk: null, processed: 1 };
  assert.deepEqual(requireImmutableCleanupProgress(complete, digest, plan), complete);
});

test("cleanup page shape follows its fixed candidate count across partial and full pages", () => {
  const files = Array.from(
    { length: PLAN.chunkEntries },
    (_, i) => `segments/${immutableSegmentFileName(i.toString(16).padStart(32, "0"))}`,
  );
  const multiPagePlan = { ...plan, candidates: PLAN.chunkEntries + 2 };
  const initial = { plan: digest, chunk: digest, offset: 0, processed: 0 };
  const first = { previous: "b".repeat(64), files: files.slice(0, 2) };
  assert.equal(requireImmutableCleanupCursorChunk(first, initial, multiPagePlan), first);
  const next = { ...initial, chunk: "b".repeat(64), processed: 2 };
  assert.equal(requireImmutableCleanupProgress(next, digest, multiPagePlan), next);
  const last = { previous: null, files };
  assert.equal(requireImmutableCleanupCursorChunk(last, next, multiPagePlan), last);
  for (const invalid of [
    { ...next, processed: 3 },
    { ...next, chunk: digest },
    { ...initial, offset: 2, processed: 2 },
  ])
    assert.throws(() => requireImmutableCleanupProgress(invalid, digest, multiPagePlan), {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    });
  for (const invalid of [
    { ...first, previous: null },
    { ...first, files },
  ])
    assert.throws(() => requireImmutableCleanupCursorChunk(invalid, initial, multiPagePlan), {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    });
});

test("cleanup candidate paths stay inside publication-owned segments and temporary head files", () => {
  const FORMAT = IMMUTABLE_LOCATED_SESSION_FORMAT;
  const segment = `segments/${immutableSegmentFileName("b".repeat(32))}`;
  for (const candidate of [
    segment,
    `${segment}.${id}.tmp`,
    `head.json.${id}.tmp`,
    `immutable-session.format.${id}.tmp`,
  ])
    assert.equal(requireImmutableCleanupCandidate(candidate, FORMAT), candidate);
  for (const candidate of [
    "head.json",
    "immutable-session.format",
    "../head.json",
    "segments/../head.json",
    segment.toUpperCase(),
    segment + ".tmp",
    "/" + segment,
    `objects/aa/${"b".repeat(62)}`,
  ])
    assert.throws(() => requireImmutableCleanupCandidate(candidate, FORMAT), {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    });
  assert.throws(
    () => requireImmutableCleanupChunk({ previous: null, files: [segment, segment] }, FORMAT),
    {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    },
  );
  assert.throws(() => requireImmutableCleanupChunk({ previous: null, files: [] }, FORMAT), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
});

test("retention checkpoints require explicit version, physical root, tail, segment count and marking cursor", () => {
  const empty = {
    format: PLAN.retentionFormat,
    root: null,
    segmentTail: null,
    size: 0,
    mark: null,
  };
  const state = { ...empty, root: reference, segmentTail: plan.head.segmentTail, size: 1 };
  assert.equal(requireImmutableCleanupRetention(empty), empty);
  assert.equal(requireImmutableCleanupRetention(state), state);
  const marking = { ...state, mark: { headsDigest: digest, rootIndex: 0, path: "a0" } };
  assert.equal(requireImmutableCleanupRetention(marking), marking);
  const { mark: _mark, ...missingMark } = state;
  for (const invalid of [
    missingMark,
    { ...state, mark: undefined },
    { ...marking, mark: { ...marking.mark, rootIndex: -1 } },
    { ...marking, mark: { ...marking.mark, rootIndex: 0.5 } },
    { ...marking, mark: { ...marking.mark, headsDigest: "invalid" } },
    { ...marking, mark: { ...marking.mark, path: "../a" } },
    { ...marking, mark: { ...marking.mark, path: "a".repeat(65) } },
    { ...marking, mark: { ...marking.mark, extra: true } },
    { ...state, format: "old" },
    { ...state, root: digest },
    { ...state, root: null },
    { ...state, segmentTail: null },
    { ...state, size: 0 },
    { ...state, size: -1 },
    { ...state, size: 0.5 },
    { ...state, size: Number.MAX_SAFE_INTEGER + 1 },
    { ...empty, size: 1 },
    { ...state, extra: true },
    { ...state, segmentTail: { ...state.segmentTail, extra: true } },
  ])
    assert.throws(() => requireImmutableCleanupRetention(invalid), {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    });
});
