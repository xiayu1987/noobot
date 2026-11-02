/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseApplyPatch, parseUnifiedDiff } from "../../src/tools/execution/file-patch/parse.js";
import { applySearchHunks, applyUnifiedHunks } from "../../src/tools/execution/file-patch/apply.js";

test("file-patch parse: unified add builds content from + lines", () => {
  const [withHeader] = parseUnifiedDiff("--- /dev/null\n+++ b/x.txt\n@@ -0,0 +1,2 @@\n+a\n+b\n", 1);
  assert.deepEqual(withHeader, {
    mode: "add",
    oldPath: "",
    newPath: "x.txt",
    hunks: [],
    content: "a\nb\n",
  });
  const [bare] = parseUnifiedDiff("--- /dev/null\n+++ b/x.txt\n@@\n+a\n+b\n", 1);
  assert.equal(bare.content, "a\nb\n");
});

test("file-patch parse: unified add rejects context and removal lines", () => {
  for (const line of [" a", "-a"]) {
    assert.throws(
      () => parseUnifiedDiff(`--- /dev/null\n+++ b/x.txt\n@@ -1,1 +1,1 @@\n+b\n${line}\n`, 1),
      (error) =>
        error.code === "RECOVERABLE_INVALID_INPUT" &&
        error.details.field === "patch" &&
        error.details.line === 2,
    );
  }
});

test("file-patch apply: overlapping hunks report the offending line", () => {
  const hunks = [
    { oldStart: 2, lines: [{ type: " ", text: "b" }] },
    { oldStart: 1, lines: [{ type: " ", text: "a" }] },
  ];
  assert.throws(
    () => applyUnifiedHunks("a\nb\n", hunks),
    (error) => error.code === "RECOVERABLE_INVALID_INPUT" && error.details.line === 1,
  );
});

const ctx = (text) => ({ type: " ", text });
const del = (text) => ({ type: "-", text });
const add = (text) => ({ type: "+", text });
const numbered = (lineNumber, text) => `${String(lineNumber).padStart(6)}\t${text}`;

test("file-patch parse: apply_patch reads optional @@ L line anchor", () => {
  const patch = "*** Begin Patch\n*** Update File: a.txt\n@@ L3\n-x\n+y\n@@\n-z\n+w\n*** End Patch";
  const [filePatch] = parseApplyPatch(patch);
  assert.equal(filePatch.hunks[0].anchorLine, 3);
  assert.equal(Object.hasOwn(filePatch.hunks[1], "anchorLine"), false);
});

test("file-patch apply: duplicated context without anchor is ambiguous", () => {
  assert.throws(
    () => applySearchHunks("x\na\nx\n", [{ lines: [del("x"), add("y")] }]),
    (error) =>
      error.code === "RECOVERABLE_INVALID_INPUT" &&
      error.details.candidateLines.join(",") === "1,3",
  );
});

test("file-patch apply: line anchor selects the nearest exact match", () => {
  const result = applySearchHunks("x\na\nx\n", [{ anchorLine: 3, lines: [del("x"), add("y")] }]);
  assert.deepEqual(result, { content: "x\na\ny\n", repairs: [] });
});

test("file-patch apply: read_file prefixes are stripped and reported", () => {
  const lines = [ctx(numbered(2, "b")), del(numbered(3, "c")), add("C")];
  for (const apply of [
    () => applySearchHunks("a\nb\nc\n", [{ lines }]),
    () => applyUnifiedHunks("a\nb\nc\n", [{ oldStart: 2, lines }]),
  ]) {
    assert.deepEqual(apply(), {
      content: "a\nb\nC\n",
      repairs: [{ kind: "line_number_prefix_stripped", line: 2, lineCount: 2 }],
    });
  }
});

test("file-patch apply: a raw line that starts with digits and tab keeps one prefix layer", () => {
  const original = "head\n5\tfoo\n";
  const exact = applySearchHunks(original, [{ lines: [del("5\tfoo"), add("bar")] }]);
  assert.deepEqual(exact, { content: "head\nbar\n", repairs: [] });
  const fromRead = applySearchHunks(original, [
    { lines: [del(numbered(2, "5\tfoo")), add("bar")] },
  ]);
  assert.equal(fromRead.content, "head\nbar\n");
  assert.equal(fromRead.repairs.length, 1);
});

test("file-patch apply: prefix repair rejects gaps and prefixed additions", () => {
  assert.throws(
    () =>
      applySearchHunks("a\nb\nc\n", [{ lines: [ctx(numbered(1, "a")), del(numbered(3, "c"))] }]),
    (error) => error.message === "apply_patch hunk context does not match target file",
  );
  assert.throws(
    () => applySearchHunks("a\nb\n", [{ lines: [del(numbered(2, "b")), add(numbered(2, "B"))] }]),
    (error) => error.message === "patch added line carries a read_file line-number prefix",
  );
});
