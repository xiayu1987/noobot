/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyFileMutation, resolveFileMutationRoot, readFileMutation } from "../../src/tools/execution/file-mutation-service.js";

test("file mutation persists before snapshot and diff, then reads the same record", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-mutation-test-"));
  try {
    const target = path.join(root, "file.txt");
    await writeFile(target, "before\n", "utf8");
    const result = await applyFileMutation({
      filePath: target,
      logicalPath: "file.txt",
      content: "after\n",
      mutationRoot: resolveFileMutationRoot(root),
    });
    assert.equal(await readFile(target, "utf8"), "after\n");
    const record = await readFileMutation({ mutationRoot: resolveFileMutationRoot(root), mutationId: result.mutation.id });
    assert.equal(record.snapshots.before, "before\n");
    assert.deepEqual(record.snapshots.diff.lines, [
      { type: "removed", oldLine: 1, newLine: null, text: "before" },
      { type: "added", oldLine: null, newLine: 1, text: "after" },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("file mutation rolls target back when record commit fails", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-mutation-rollback-"));
  const target = path.join(root, "file.txt");
  try {
    await writeFile(target, "before\n", "utf8");
    await writeFile(path.join(root, "records"), "not-a-directory", "utf8");
    await assert.rejects(
      applyFileMutation({
        filePath: target,
        logicalPath: "file.txt",
        content: "after\n",
        mutationRoot: path.join(root, "records"),
        writeText: async (filePath, content) => writeFile(filePath, content, "utf8"),
      }),
      /EEXIST|file mutation commit failed/,
    );
    assert.equal(await readFile(target, "utf8"), "before\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("delete mutation persists the before snapshot and a removal diff", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-mutation-delete-"));
  try {
    const target = path.join(root, "file.txt");
    await writeFile(target, "before\n", "utf8");
    const result = await applyFileMutation({
      filePath: target,
      logicalPath: "file.txt",
      operation: "delete",
      mutationRoot: resolveFileMutationRoot(root),
    });
    await assert.rejects(stat(target), { code: "ENOENT" });
    const record = await readFileMutation({ mutationRoot: resolveFileMutationRoot(root), mutationId: result.mutation.id });
    assert.equal(record.snapshots.before, "before\n");
    assert.deepEqual(record.snapshots.diff.lines, [
      { type: "removed", oldLine: 1, newLine: null, text: "before" },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("multi-file callers can roll back every committed mutation after a later write fails", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-mutation-multi-rollback-"));
  const first = path.join(root, "first.txt");
  const second = path.join(root, "second.txt");
  const mutationRoot = resolveFileMutationRoot(root);
  try {
    await writeFile(first, "first-before\n", "utf8");
    await writeFile(second, "second-before\n", "utf8");
    const writeText = async (filePath, content) => {
      if (filePath === second && content === "second-after\n") {
        const error = new Error("injected second write failure");
        error.code = "injected_write_failure";
        throw error;
      }
      await writeFile(filePath, content, "utf8");
    };
    const firstMutation = await applyFileMutation({
      filePath: first,
      logicalPath: "first.txt",
      content: "first-after\n",
      mutationRoot,
      writeText,
    });
    await assert.rejects(
      applyFileMutation({
        filePath: second,
        logicalPath: "second.txt",
        content: "second-after\n",
        mutationRoot,
        writeText,
      }),
      { code: "injected_write_failure" },
    );
    await writeFile(first, "first-before\n", "utf8");
    await rm(path.join(mutationRoot, `${firstMutation.mutation.id}.json`), { force: true });
    assert.equal(await readFile(first, "utf8"), "first-before\n");
    assert.equal(await readFile(second, "utf8"), "second-before\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
