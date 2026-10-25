/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_ERROR_CODE, assertSessionManifestLayout } from "../src/index.js";

function turnItem(overrides = {}) {
  return {
    turnId: "turn-000001",
    turnScopeId: "scope-1",
    file: "turns/turn-000001.jsonl",
    committedBytes: 10,
    recordCount: 1,
    messageOrder: ["m1"],
    messageHashes: { m1: "h1" },
    summarySnapshots: [],
    compacted: false,
    ...overrides,
  };
}

function manifest(overrides = {}) {
  return {
    turnArtifactSequence: 1,
    turnOrder: [turnItem()],
    messageOrder: [{ messageUid: "m1" }],
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
  ]) {
    assert.throws(() => assertSessionManifestLayout(manifest(overrides)), rejected(overrides));
  }
  assert.throws(() => assertSessionManifestLayout(null), rejected(null));
});

test("turn item layout violations are rejected", () => {
  for (const overrides of [
    { turnId: "" },
    { turnScopeId: undefined },
    { file: undefined },
    { messageOrder: undefined },
    { messageOrder: [{ messageUid: "m1" }] },
    { summarySnapshots: undefined },
    { messageHashes: undefined },
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
