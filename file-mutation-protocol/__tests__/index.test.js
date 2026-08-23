/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  assertFileMutationResult,
  createFileDiff,
  createFileMutationDiffPreview,
  createFileMutationFilePreview,
  createFileMutationResult,
} from "../src/index.js";

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
  assert.equal(result.mutations[0].diff.lines, undefined);
  assert.equal(assertFileMutationResult(result), result);
});

test("file mutation preview responses are projected from the canonical result", () => {
  const result = createFileMutationResult({
    id: "11111111-1111-4111-8111-111111111111",
    operation: "update",
    path: "src/example.js",
    fileName: "example.js",
    before: { exists: true, isText: true, size: 4, sha256: "before" },
    after: { exists: true, isText: true, size: 3, sha256: "after" },
    diff: createFileDiff("old\n", "new\n"),
  });
  const stored = {
    ...result,
    snapshots: {
      before: "old\n",
      after: "new\n",
      diff: createFileDiff("old\n", "new\n"),
    },
  };
  assert.deepEqual(createFileMutationDiffPreview(stored), {
    ok: true,
    protocol: result.protocol,
    version: result.version,
    mutationId: result.mutations[0].id,
    path: "src/example.js",
    diff: stored.snapshots.diff,
  });
  assert.deepEqual(createFileMutationFilePreview(stored), {
    ok: true,
    protocol: result.protocol,
    version: result.version,
    mutationId: result.mutations[0].id,
    path: "src/example.js",
    isText: true,
    size: 3,
    content: "new\n",
  });
});
