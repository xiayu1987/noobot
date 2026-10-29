/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  SESSION_ERROR_CODE,
  assertSessionManifestLayout,
  createEmptyTurnLifecycle,
} from "../src/index.js";

const HASH_M1 = `sha256:${"a".repeat(64)}`;

function turnItem(overrides = {}) {
  return {
    turnId: "turn-000001",
    turnScopeId: "scope-1",
    dialogProcessId: "dialog-1",
    file: "turns/turn-000001.jsonl",
    committedBytes: 10,
    recordCount: 1,
    messageOrder: ["m1"],
    messageHashes: { m1: HASH_M1 },
    summarySnapshots: [snapshotIndex()],
    compacted: false,
    ...overrides,
  };
}

function snapshotIndex(overrides = {}) {
  return {
    checkpointId: "checkpoint-1",
    checkpointRevision: 1,
    committedAt: "2026-01-01T00:00:00.000Z",
    contentHash: "sha256:abc",
    file: "turn-snapshots/turn-000001/checkpoint-000001.json",
    messageUids: ["m1"],
    ...overrides,
  };
}

function manifest(overrides = {}) {
  return {
    turnArtifactSequence: 1,
    turnOrder: [turnItem()],
    messageOrder: [{ messageUid: "m1" }],
    turnLifecycle: createEmptyTurnLifecycle(),
    ...overrides,
  };
}

const rejected = () => (error) => {
  assert.equal(error.code, SESSION_ERROR_CODE.MANIFEST_LAYOUT_INVALID);
  return true;
};

test("canonical manifest layout is accepted as-is", () => {
  const source = manifest();
  assert.equal(assertSessionManifestLayout(source), source);
});

test("manifest-level layout violations are rejected", () => {
  for (const overrides of [
    { turnOrder: undefined },
    { messageOrder: undefined },
    { messageOrder: [{ turnId: "turn-000001", messageIndex: 0 }] },
    { turnArtifactSequence: undefined },
    { turnArtifactSequence: -1 },
    { turnLifecycle: undefined },
    { turnLifecycle: { ...createEmptyTurnLifecycle(), turns: undefined } },
    { turnLifecycle: { ...createEmptyTurnLifecycle(), commandReceipts: {} } },
  ]) {
    assert.throws(() => assertSessionManifestLayout(manifest(overrides)), rejected(overrides));
  }
  assert.throws(() => assertSessionManifestLayout(null), rejected(null));
});

test("turn item layout violations are rejected", () => {
  for (const overrides of [
    { turnId: "" },
    { turnScopeId: undefined },
    { dialogProcessId: undefined },
    { dialogProcessId: "" },
    { dialogProcessId: "dialog 1" },
    { file: undefined },
    { messageOrder: undefined },
    { messageOrder: [{ messageUid: "m1" }] },
    { summarySnapshots: undefined },
    { summarySnapshots: [null] },
    { summarySnapshots: [snapshotIndex({ checkpointId: undefined })] },
    { summarySnapshots: [snapshotIndex({ checkpointRevision: 0 })] },
    { summarySnapshots: [snapshotIndex({ committedAt: "" })] },
    { summarySnapshots: [snapshotIndex({ contentHash: undefined })] },
    { summarySnapshots: [snapshotIndex({ file: undefined })] },
    { summarySnapshots: [snapshotIndex({ messageUids: undefined })] },
    { summarySnapshots: [snapshotIndex({ messageUids: [""] })] },
    { messageHashes: undefined },
    { messageHashes: {} },
    { messageHashes: { m1: HASH_M1, m2: HASH_M1 } },
    { messageHashes: { m2: HASH_M1 } },
    { messageHashes: { m1: "h1" } },
    { messageHashes: { m1: `sha256:${"A".repeat(64)}` } },
    { committedBytes: undefined },
    { recordCount: -1 },
    { compacted: undefined },
  ]) {
    const source = manifest({ turnOrder: [turnItem(overrides)] });
    assert.throws(() => assertSessionManifestLayout(source), rejected(overrides));
  }
  assert.throws(
    () => assertSessionManifestLayout(manifest({ turnOrder: ["turns/legacy.json"] })),
    rejected("string item"),
  );
});

test("turnOrder identities must be unique", () => {
  const second = {
    turnId: "turn-000002",
    turnScopeId: "scope-2",
    file: "turns/turn-000002.jsonl",
    messageOrder: ["m2"],
    messageHashes: { m2: HASH_M1 },
  };
  const messageOrder = [{ messageUid: "m1" }, { messageUid: "m2" }];
  assert.doesNotThrow(() =>
    assertSessionManifestLayout(
      manifest({ turnOrder: [turnItem(), turnItem(second)], messageOrder }),
    ),
  );
  for (const key of ["turnId", "turnScopeId", "file"]) {
    const duplicate = turnItem({ ...second, [key]: turnItem()[key] });
    assert.throws(
      () =>
        assertSessionManifestLayout(manifest({ turnOrder: [turnItem(), duplicate], messageOrder })),
      rejected(key),
    );
  }
});

test("top-level messageOrder must exactly cover turn messages", () => {
  const second = turnItem({
    turnId: "turn-000002",
    turnScopeId: "scope-2",
    file: "turns/turn-000002.jsonl",
  });
  const cases = [
    ["message owned by two turns", { turnOrder: [turnItem(), second] }],
    [
      "duplicated top-level reference",
      { messageOrder: [{ messageUid: "m1" }, { messageUid: "m1" }] },
    ],
    [
      "reference without owning turn",
      { messageOrder: [{ messageUid: "m1" }, { messageUid: "m9" }] },
    ],
    ["turn message not covered", { messageOrder: [] }],
  ];
  for (const [label, overrides] of cases) {
    assert.throws(() => assertSessionManifestLayout(manifest(overrides)), rejected(label));
  }
});
