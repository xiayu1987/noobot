/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseUnifiedDiff } from "../../src/tools/execution/file-patch.js";

test("patch_file: unified_diff 保留 Windows 绝对路径与 file URL 语义", () => {
  const driveDiff = [
    "--- C:\\work\\src\\a.txt",
    "+++ C:\\work\\src\\a.txt",
    "@@ -1,1 +1,1 @@",
    "-old",
    "+new",
    "",
  ].join("\n");
  const drivePatch = parseUnifiedDiff(driveDiff, 1)[0];
  assert.equal(drivePatch.oldPath, "C:/work/src/a.txt");
  assert.equal(drivePatch.newPath, "C:/work/src/a.txt");

  const fileUrlDiff = [
    "--- file:///C:/work/src/a.txt",
    "+++ file:///C:/work/src/a.txt",
    "@@ -1,1 +1,1 @@",
    "-old",
    "+new",
    "",
  ].join("\n");
  const fileUrlPatch = parseUnifiedDiff(fileUrlDiff, 1)[0];
  assert.equal(fileUrlPatch.oldPath, "C:/work/src/a.txt");
  assert.equal(fileUrlPatch.newPath, "C:/work/src/a.txt");
});

test("patch_file: unified_diff 在 strip 后保留父目录组件供权威路径解析器拒绝", () => {
  const oneParent = parseUnifiedDiff(
    ["--- /dev/null", "+++ b/../escape.txt", "@@ -0,0 +1 @@", "+escape", ""].join("\n"),
    1,
  )[0];
  assert.equal(oneParent.newPath, "../escape.txt");

  const twoParents = parseUnifiedDiff(
    ["--- /dev/null", "+++ b/../../escape.txt", "@@ -0,0 +1 @@", "+escape", ""].join("\n"),
    1,
  )[0];
  assert.equal(twoParents.newPath, "../../escape.txt");
});
