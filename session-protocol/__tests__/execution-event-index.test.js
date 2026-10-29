/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  EXECUTION_EVENT_INDEX_ERROR_CODE,
  EXECUTION_EVENT_INDEX_FILE,
  EXECUTION_EVENT_INDEX_SCHEMA_VERSION,
  EXECUTION_EVENT_SEGMENT_ERROR_CODE,
  EXECUTION_EVENT_TURNS_DIR,
  createSessionExecutionIndex,
  createTurnExecutionIndex,
  decodeExecutionSegment,
  decodeExecutionSegmentRecord,
  encodeExecutionSegmentRecord,
  executionSegmentFileName,
  executionSegmentTornWrite,
  LEGACY_V2_EXECUTION_EVENT_INDEX_SCHEMA_VERSION,
  requireLegacyV2SessionExecutionIndex,
  requireLegacyV2TurnExecutionIndex,
  upgradeLegacyV2SessionExecutionIndex,
  upgradeLegacyV2TurnExecutionIndex,
  requireSessionExecutionIndex,
  requireTurnExecutionIndex,
} from "../src/index.js";
import * as subpath from "@noobot/session-protocol/execution-event-index";

const segment = (sequence, overrides = {}) => ({
  sequence,
  file: executionSegmentFileName(sequence),
  bytes: 10,
  records: 1,
  sealed: false,
  ...overrides,
});

test("execution event index protocol is exported once from root and subpath", () => {
  assert.equal(EXECUTION_EVENT_INDEX_SCHEMA_VERSION, 3);
  assert.equal(EXECUTION_EVENT_INDEX_FILE, "index.json");
  assert.equal(EXECUTION_EVENT_TURNS_DIR, "turns");
  assert.equal(subpath.EXECUTION_EVENT_INDEX_FILE, EXECUTION_EVENT_INDEX_FILE);
  assert.equal(subpath.EXECUTION_EVENT_TURNS_DIR, EXECUTION_EVENT_TURNS_DIR);
  assert.equal(subpath.requireTurnExecutionIndex, requireTurnExecutionIndex);
  assert.equal(subpath.EXECUTION_EVENT_INDEX_SCHEMA_VERSION, EXECUTION_EVENT_INDEX_SCHEMA_VERSION);
});

test("session index keeps only dialogProcessId turn references and is frozen", () => {
  const index = createSessionExecutionIndex([{ dialogProcessId: "dp-1" }]);
  assert.deepEqual(index, { schemaVersion: 3, turns: [{ dialogProcessId: "dp-1" }] });
  assert.ok(Object.isFrozen(index));
  assert.ok(Object.isFrozen(index.turns));
  assert.ok(Object.isFrozen(index.turns[0]));
});

test("session index rejects invalid, duplicated and missing turns", () => {
  for (const turns of [
    [{ dialogProcessId: "" }],
    [{ dialogProcessId: "dp/1" }],
    [null],
    [{ dialogProcessId: "dp-1" }, { dialogProcessId: "dp-1" }],
  ]) {
    assert.throws(() => createSessionExecutionIndex(turns), {
      code: EXECUTION_EVENT_INDEX_ERROR_CODE.CORRUPTED,
    });
  }
  assert.throws(() => requireSessionExecutionIndex({ schemaVersion: 3 }), {
    code: EXECUTION_EVENT_INDEX_ERROR_CODE.CORRUPTED,
  });
});

test("v2 and non-object documents are rejected", () => {
  assert.throws(() => requireTurnExecutionIndex({ schemaVersion: 2, segments: [] }), {
    code: EXECUTION_EVENT_INDEX_ERROR_CODE.SCHEMA_UNSUPPORTED,
  });
  assert.throws(() => requireSessionExecutionIndex({ schemaVersion: 2, turns: [] }), {
    code: EXECUTION_EVENT_INDEX_ERROR_CODE.SCHEMA_UNSUPPORTED,
  });
  for (const value of [null, [], "x"]) {
    assert.throws(() => requireTurnExecutionIndex(value), {
      code: EXECUTION_EVENT_INDEX_ERROR_CODE.CORRUPTED,
    });
  }
});

test("turn index rejects retired redundant and unknown fields", () => {
  for (const extra of [
    { dialogProcessId: "dp-1" },
    { activeSequence: 1 },
    { maxSegmentBytes: 100 },
  ]) {
    assert.throws(
      () => requireTurnExecutionIndex({ schemaVersion: 3, segments: [segment(1)], ...extra }),
      { code: EXECUTION_EVENT_INDEX_ERROR_CODE.CORRUPTED },
    );
  }
  assert.throws(() => createTurnExecutionIndex([segment(1, { extra: true })]), {
    code: EXECUTION_EVENT_INDEX_ERROR_CODE.CORRUPTED,
  });
  assert.throws(() => requireSessionExecutionIndex({ schemaVersion: 3, turns: [], extra: true }), {
    code: EXECUTION_EVENT_INDEX_ERROR_CODE.CORRUPTED,
  });
  assert.throws(() => createSessionExecutionIndex([{ dialogProcessId: "dp-1", extra: true }]), {
    code: EXECUTION_EVENT_INDEX_ERROR_CODE.CORRUPTED,
  });
});

test("turn index is frozen", () => {
  const index = createTurnExecutionIndex([
    segment(1, { sealed: true }),
    segment(2, { oversized: true }),
  ]);
  assert.deepEqual(Object.keys(index), ["schemaVersion", "segments"]);
  assert.deepEqual(index.segments[1], { ...segment(2), oversized: true });
  assert.ok(Object.isFrozen(index.segments));
  assert.ok(Object.isFrozen(index.segments[0]));
  assert.throws(() => {
    index.segments[0].bytes = 1;
  }, TypeError);
});

test("turn index enforces strictly increasing sequence and canonical segment fields", () => {
  const invalid = [
    [segment(0)],
    [segment(2, { sealed: true }), segment(2)],
    [segment(2, { sealed: true }), segment(1)],
    [segment(1), segment(2)],
    [segment(1, { file: "../x.jsonl" })],
    [segment(1, { file: "a/b.jsonl" })],
    [segment(1, { file: "a\\b.jsonl" })],
    [segment(1, { file: executionSegmentFileName(2) })],
    [segment(1, { bytes: -1 })],
    [segment(1, { records: 1.5 })],
    [segment(1, { sealed: "false" })],
    [segment(1, { oversized: false })],
  ];
  for (const segments of invalid) {
    assert.throws(() => createTurnExecutionIndex(segments), {
      code: EXECUTION_EVENT_INDEX_ERROR_CODE.CORRUPTED,
    });
  }
  assert.throws(() => requireTurnExecutionIndex({ schemaVersion: 3 }), {
    code: EXECUTION_EVENT_INDEX_ERROR_CODE.CORRUPTED,
  });
});

test("segment file names are derived from sequence only", () => {
  assert.equal(executionSegmentFileName(7), "segment-000007.jsonl");
});

test("segment record encoding counts UTF-8 bytes and requires plain objects", () => {
  const encoded = encodeExecutionSegmentRecord({ text: "中" });
  assert.equal(encoded.line, '{"text":"中"}\n');
  assert.equal(encoded.bytes, Buffer.byteLength(encoded.line, "utf8"));
  for (const value of [null, [], "x", 1]) {
    assert.throws(() => encodeExecutionSegmentRecord(value), TypeError);
  }
});

test("segment decoding round-trips encoded records with byte and record counts", () => {
  const lines = [{ id: 1 }, { id: 2, text: "中文" }].map(encodeExecutionSegmentRecord);
  const raw = lines.map((entry) => entry.line).join("");
  const decoded = decodeExecutionSegment(raw, "segment-000001.jsonl");
  assert.equal(
    decoded.bytes,
    lines.reduce((total, entry) => total + entry.bytes, 0),
  );
  assert.deepEqual(decoded.records, [{ id: 1 }, { id: 2, text: "中文" }]);
  assert.deepEqual(decodeExecutionSegment("", "segment-000001.jsonl"), { bytes: 0, records: [] });
});

test("segment decoding rejects torn writes, blank lines and non-object records", () => {
  assert.throws(() => decodeExecutionSegment('{"id":1}', "f"), {
    code: EXECUTION_EVENT_SEGMENT_ERROR_CODE.TORN_WRITE,
  });
  for (const raw of ['{"id":1}\n\n', "\n", "[1]\n", "1\n", "{bad\n"]) {
    assert.throws(() => decodeExecutionSegment(raw, "f"), {
      code: EXECUTION_EVENT_SEGMENT_ERROR_CODE.JSONL_CORRUPTED,
    });
  }
  assert.throws(() => decodeExecutionSegmentRecord("", "f"), {
    code: EXECUTION_EVENT_SEGMENT_ERROR_CODE.JSONL_CORRUPTED,
  });
  assert.equal(executionSegmentTornWrite("f").code, EXECUTION_EVENT_SEGMENT_ERROR_CODE.TORN_WRITE);
  assert.throws(() => decodeExecutionSegment(Buffer.from(""), "f"), TypeError);
});

const v2Turn = (overrides = {}) => ({
  schemaVersion: 2,
  dialogProcessId: "dp-1",
  activeSequence: 2,
  maxSegmentBytes: 100,
  segments: [segment(1, { sealed: true }), segment(2)],
  ...overrides,
});

test("v2 turn index upgrades to v3 by dropping only the redundant fields", () => {
  assert.equal(LEGACY_V2_EXECUTION_EVENT_INDEX_SCHEMA_VERSION, 2);
  const upgraded = upgradeLegacyV2TurnExecutionIndex(v2Turn(), "dp-1");
  assert.deepEqual(upgraded, {
    schemaVersion: 3,
    segments: [segment(1, { sealed: true }), segment(2)],
  });
  assert.ok(Object.isFrozen(upgraded));
  const empty = upgradeLegacyV2TurnExecutionIndex(
    v2Turn({ activeSequence: 0, segments: [] }),
    "dp-1",
  );
  assert.deepEqual(empty, { schemaVersion: 3, segments: [] });
  assert.equal(requireLegacyV2TurnExecutionIndex(v2Turn(), "dp-1").maxSegmentBytes, 100);
});

test("v2 turn index rejects mismatched, invalid and unknown facts", () => {
  for (const [index, key] of [
    [v2Turn(), "dp-2"],
    [v2Turn({ activeSequence: 1 }), "dp-1"],
    [v2Turn({ maxSegmentBytes: 0 }), "dp-1"],
    [v2Turn({ maxSegmentBytes: "100" }), "dp-1"],
    [v2Turn({ extra: true }), "dp-1"],
    [v2Turn({ segments: [{ file: "segment-1.jsonl", bytes: 1, records: 1 }] }), "dp-1"],
    [null, "dp-1"],
  ]) {
    assert.throws(() => requireLegacyV2TurnExecutionIndex(index, key), {
      code: EXECUTION_EVENT_INDEX_ERROR_CODE.CORRUPTED,
    });
  }
  for (const schemaVersion of [1, 3]) {
    assert.throws(() => requireLegacyV2TurnExecutionIndex(v2Turn({ schemaVersion }), "dp-1"), {
      code: EXECUTION_EVENT_INDEX_ERROR_CODE.SCHEMA_UNSUPPORTED,
    });
  }
});

test("v2 session index upgrades to v3 and keeps v3 turn reference rules", () => {
  const v2 = { schemaVersion: 2, turns: [{ dialogProcessId: "dp-1" }] };
  assert.deepEqual(requireLegacyV2SessionExecutionIndex(v2), [{ dialogProcessId: "dp-1" }]);
  assert.deepEqual(upgradeLegacyV2SessionExecutionIndex(v2), {
    schemaVersion: 3,
    turns: [{ dialogProcessId: "dp-1" }],
  });
  assert.throws(
    () =>
      requireLegacyV2SessionExecutionIndex({
        schemaVersion: 2,
        turns: [{ dialogProcessId: "dp-1" }, { dialogProcessId: "dp-1" }],
      }),
    { code: EXECUTION_EVENT_INDEX_ERROR_CODE.CORRUPTED },
  );
  assert.throws(() => requireLegacyV2SessionExecutionIndex({ ...v2, extra: 1 }), {
    code: EXECUTION_EVENT_INDEX_ERROR_CODE.CORRUPTED,
  });
  assert.throws(() => requireLegacyV2SessionExecutionIndex({ ...v2, schemaVersion: 3 }), {
    code: EXECUTION_EVENT_INDEX_ERROR_CODE.SCHEMA_UNSUPPORTED,
  });
});
