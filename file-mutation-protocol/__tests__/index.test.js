/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createFileDiff, createFileMutationResult, assertFileMutationResult } from "../src/index.js";

test("file diff preserves Git line semantics and mutation result omits full lines", () => {
  const diff = createFileDiff("same\nold\n", "same\nnew\nextra\n");
  assert.deepEqual(diff.lines, [
    { type: "context", oldLine: 1, newLine: 1, text: "same" },
    { type: "removed", oldLine: 2, newLine: null, text: "old" },
    { type: "added", oldLine: null, newLine: 2, text: "new" },
    { type: "added", oldLine: null, newLine: 3, text: "extra" },
  ]);
  const result = createFileMutationResult({
    id: "mutation-id",
    operation: "update",
    path: "a.txt",
    fileName: "a.txt",
    before: { exists: true },
    after: { exists: true },
    diff,
  });
  assert.equal(result.mutation.diff.lines, undefined);
  assert.equal(assertFileMutationResult(result), result);
});
