/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseUnifiedDiff } from "../../src/tools/execution/file-patch/parse.js";
import { applyUnifiedHunks } from "../../src/tools/execution/file-patch/apply.js";

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
