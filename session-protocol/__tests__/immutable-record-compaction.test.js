/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  IMMUTABLE_COMPACTION_BUDGET,
  requireImmutableCompactionRecords,
  requireImmutableRelocationSource,
  immutableRelocationSourceChanged,
  requireImmutableRelocationConflict,
  requireImmutableCompactionResult,
  IMMUTABLE_LOCATION_RETIREMENT,
  requireImmutableLocationRetirementTaskPage,
} from "../src/immutable-record-location.js";
import {
  encodeImmutableRecordReference,
  decodeImmutableRecordReference,
  IMMUTABLE_SEGMENT,
} from "../src/immutable-segment.js";

function source(i, length = 1) {
  const identity = i.toString(16).padStart(64, "0");
  return {
    identity,
    sourceLocation: encodeImmutableRecordReference({
      segmentId: "1".repeat(32),
      offset: IMMUTABLE_SEGMENT.magic.length,
      length,
      digest: identity,
    }),
  };
}

test("retirement task pages bound fanout and reject malformed persisted tasks", () => {
  const task = { reference: source(1).identity, kind: "raw", bytes: 1 };
  const page = {
    previous: source(2).sourceLocation,
    previousOffset: 0,
    tasks: Array.from({ length: IMMUTABLE_LOCATION_RETIREMENT.tasksPerPage }, () => task),
  };
  assert.equal(requireImmutableLocationRetirementTaskPage(page), page);
  for (const invalid of [
    null,
    {},
    { tasks: [task] },
    { ...page, tasks: [] },
    { ...page, tasks: [...page.tasks, task] },
    { ...page, ignored: true },
    { ...page, previous: source(2).identity },
    { ...page, previousOffset: undefined },
    { ...page, previousOffset: -1 },
    { ...page, previousOffset: 0.5 },
    { ...page, previousOffset: IMMUTABLE_LOCATION_RETIREMENT.tasksPerPage },
    { ...page, previous: null, previousOffset: 1 },
    { ...page, tasks: [null] },
    { ...page, tasks: [{ ...task, kind: "unknown" }] },
    { ...page, tasks: [{ ...task, reference: source(1).sourceLocation }] },
  ])
    assert.throws(() => requireImmutableLocationRetirementTaskPage(invalid), {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    });
});

test("retirement tasks require exact protocol-owned traversal context", () => {
  const reference = source(1).identity;
  const validate = (task) =>
    requireImmutableLocationRetirementTaskPage({
      previous: null,
      previousOffset: 0,
      tasks: [task],
    });
  for (const kind of ["page", "commit", "operation"]) validate({ kind, reference });
  validate({ kind: "raw", reference, bytes: 0 });
  validate({ kind: "bytes", reference, bytes: 1, depth: 0 });
  for (const prefix of ["", "01", "1".repeat(53)]) validate({ kind: "title", reference, prefix });
  for (const collection of ["collections", "operations", "scalar", "messages", "metadata"])
    for (const prefix of ["", "a3", "f".repeat(64)])
      validate({ kind: "index", reference, collection, prefix });
  validate({ kind: "collection", reference, collection: "metadata", key: "titleIndex" });
  for (const task of [
    { kind: "raw", reference },
    { kind: "raw", reference, bytes: -1 },
    { kind: "raw", reference, bytes: Number.MAX_SAFE_INTEGER },
    { kind: "raw", reference, bytes: 0, ignored: true },
    { kind: "raw", reference, bytes: 0, depth: 0 },
    { kind: "bytes", reference, bytes: 1 },
    { kind: "bytes", reference, bytes: -1, depth: 0 },
    { kind: "bytes", reference, bytes: 1.5, depth: 0 },
    { kind: "bytes", reference, bytes: 1, depth: -1 },
    { kind: "bytes", reference, bytes: 1, depth: 1.5 },
    { kind: "bytes", reference, bytes: 1, depth: Number.MAX_SAFE_INTEGER },
    { kind: "page", reference, collection: "messages" },
    { kind: "index", reference },
    { kind: "title", reference },
    { kind: "title", reference, prefix: "2" },
    { kind: "title", reference, prefix: "0".repeat(54) },
    { kind: "title", reference, prefix: null },
    { kind: "index", reference, collection: "messages" },
    { kind: "index", reference, collection: "unknown", prefix: "" },
    { kind: "index", reference, collection: "messages", prefix: "g" },
    { kind: "index", reference, collection: "messages", prefix: "0".repeat(65) },
    { kind: "index", reference, collection: "messages", prefix: null },
    { kind: "index", reference, collection: "messages", prefix: "", key: "unexpected" },
    { kind: "collection", reference, collection: "metadata" },
    { kind: "collection", reference, collection: "metadata", key: "" },
    { kind: "collection", reference, collection: "metadata", key: 1 },
    { kind: "collection", reference, collection: "collections", key: "item" },
    { kind: "collection", reference, collection: "unknown", key: "item" },
    { kind: "collection", reference, collection: "metadata", key: "titleIndex", ignored: true },
  ])
    assert.throws(() => validate(task), {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    });
});

test("compaction source identity and physical location are one strict contract", () => {
  assert.equal(requireImmutableRelocationSource(source(1)).identity, source(1).identity);
  for (const value of [source(1).identity, {}, { ...source(1), inferred: true }])
    assert.throws(() => requireImmutableRelocationSource(value), /identity and sourceLocation/);
  assert.throws(
    () =>
      requireImmutableRelocationSource({ ...source(1), sourceLocation: source(2).sourceLocation }),
    { code: "SESSION_IMMUTABLE_STORAGE_INVALID" },
  );
});

test("compaction independently bounds record count and aggregate source bytes", () => {
  const maximum = Array.from({ length: IMMUTABLE_COMPACTION_BUDGET.records }, (_, i) => source(i));
  assert.equal(requireImmutableCompactionRecords(maximum), maximum);
  assert.throws(
    () => requireImmutableCompactionRecords([...maximum, source(maximum.length)]),
    /bounded non-empty/,
  );
  assert.throws(() => requireImmutableCompactionRecords([source(1), source(1)]), /Duplicate/);
  const large = Array.from(
    { length: Math.floor(IMMUTABLE_COMPACTION_BUDGET.bytes / IMMUTABLE_SEGMENT.recordBytes) },
    (_, i) => source(i, IMMUTABLE_SEGMENT.recordBytes),
  );
  requireImmutableCompactionRecords(large);
  assert.throws(
    () => requireImmutableCompactionRecords([...large, source(large.length)]),
    /byte budget/,
  );
});

test("compaction results account for successful and conflicting sources exactly once", () => {
  const first = source(1);
  const second = source(2);
  const currentLocation = encodeImmutableRecordReference({
    ...decodeImmutableRecordReference(first.sourceLocation),
    segmentId: "2".repeat(32),
  });
  const error = immutableRelocationSourceChanged(first, currentLocation);
  assert.equal(error.code, "SESSION_RELOCATION_SOURCE_CHANGED");
  const conflict = { ...first, currentLocation };
  assert.deepEqual(error.conflict, conflict);
  assert.equal(requireImmutableRelocationConflict(conflict), conflict);
  const result = { relocatedRecords: 1, conflicts: [conflict] };
  assert.equal(requireImmutableCompactionResult(result, [first, second]), result);
  for (const invalid of [
    {},
    { relocatedRecords: 1, conflicts: [] },
    { relocatedRecords: -1, conflicts: [conflict, conflict, conflict] },
    { relocatedRecords: 0, conflicts: [conflict, conflict] },
    { ...result, ignored: true },
    { ...result, conflicts: [{ ...conflict, sourceLocation: currentLocation }] },
    { ...result, conflicts: [{ ...conflict, identity: second.identity }] },
  ])
    assert.throws(() => requireImmutableCompactionResult(invalid, [first, second]));
  assert.throws(() => immutableRelocationSourceChanged(first, first.sourceLocation));
  assert.throws(() => requireImmutableRelocationConflict({ ...conflict, ignored: true }));
  const absent = immutableRelocationSourceChanged(first, null).conflict;
  assert.deepEqual(absent, { ...first, currentLocation: null });
  assert.deepEqual(
    requireImmutableCompactionResult({ relocatedRecords: 1, conflicts: [absent] }, [first, second]),
    { relocatedRecords: 1, conflicts: [absent] },
  );
  for (const currentLocation of [undefined, "", false, source(2).sourceLocation])
    assert.throws(() => requireImmutableRelocationConflict({ ...conflict, currentLocation }));
});
