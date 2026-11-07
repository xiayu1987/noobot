/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createFileDiff } from "../src/index.js";

function referenceLength(oldLines, newLines) {
  const scores = Array.from(
    { length: oldLines.length + 1 },
    () => new Uint32Array(newLines.length + 1),
  );
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      scores[oldIndex][newIndex] =
        oldLines[oldIndex] === newLines[newIndex]
          ? scores[oldIndex + 1][newIndex + 1] + 1
          : Math.max(scores[oldIndex + 1][newIndex], scores[oldIndex][newIndex + 1]);
    }
  }
  return scores[0][0];
}

test("diff reconstructs both inputs and retains a longest common subsequence", () => {
  const cases = [[]];
  for (let length = 1; length <= 5; length += 1) {
    for (let mask = 0; mask < 2 ** length; mask += 1) {
      cases.push(Array.from({ length }, (_, index) => (mask & (1 << index) ? "a" : "b")));
    }
  }
  for (const before of cases) {
    for (const after of cases) {
      const diff = createFileDiff(
        before.length ? before.join("\n") + "\n" : "",
        after.length ? after.join("\n") + "\n" : "",
      );
      assert.deepEqual(
        diff.lines.filter((line) => line.type !== "added").map((line) => line.text),
        before,
      );
      assert.deepEqual(
        diff.lines.filter((line) => line.type !== "removed").map((line) => line.text),
        after,
      );
      const common = referenceLength(before, after);
      assert.equal(diff.additions, after.length - common);
      assert.equal(diff.deletions, before.length - common);
      let oldLine = 0;
      let newLine = 0;
      for (const row of diff.lines) {
        assert.equal(row.oldLine, row.type === "added" ? null : ++oldLine);
        assert.equal(row.newLine, row.type === "removed" ? null : ++newLine);
      }
    }
  }
});

test("large equal, sparse and disjoint inputs avoid a full LCS matrix", () => {
  const lines = Array.from({ length: 20000 }, (_, index) => `line-${index}`);
  const source = lines.join("\n") + "\n";
  assert.equal(createFileDiff(source, source).changedLines, 0);
  lines[10000] = "changed";
  assert.equal(createFileDiff(source, lines.join("\n") + "\n").changedLines, 2);
  const replaced = createFileDiff("old\n".repeat(20000), "new\n".repeat(20000));
  assert.equal(replaced.additions, 20000);
  assert.equal(replaced.deletions, 20000);
});
