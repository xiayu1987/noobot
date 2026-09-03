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
import {
  applyFileMutation,
  readFileMutation,
  resolveFileMutationRoot,
  rollbackFileMutation,
} from "../../src/tools/execution/file-mutation-service.js";

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
    await stat(path.join(root, "file-mutations", `${result.mutations[0].id}.json`));
    const record = await readFileMutation({
      mutationRoot: resolveFileMutationRoot(root),
      mutationId: result.mutations[0].id,
    });
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
    const record = await readFileMutation({
      mutationRoot: resolveFileMutationRoot(root),
      mutationId: result.mutations[0].id,
    });
    assert.equal(record.snapshots.before, "before\n");
    assert.deepEqual(record.snapshots.diff.lines, [
      { type: "removed", oldLine: 1, newLine: null, text: "before" },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("update mutations keep one initial snapshot and append incremental diffs per scope", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-mutation-aggregate-"));
  try {
    const target = path.join(root, "file.txt");
    const mutationRoot = resolveFileMutationRoot(root);
    await writeFile(target, "base\n", "utf8");
    const first = await applyFileMutation({
      filePath: target,
      logicalPath: "file.txt",
      content: "middle\n",
      operation: "update",
      scopeId: "turn-1",
      mutationRoot,
    });
    const second = await applyFileMutation({
      filePath: target,
      logicalPath: "file.txt",
      content: "final\n",
      operation: "update",
      scopeId: "turn-1",
      mutationRoot,
    });
    assert.equal(first.mutations[0].id, second.mutations[0].id);
    assert.equal(first.mutations[0].aggregate.revision, 1);
    assert.equal(second.mutations[0].aggregate.revision, 2);
    const record = await readFileMutation({
      mutationRoot,
      mutationId: second.mutations[0].id,
    });
    assert.equal(record.snapshots.before, "base\n");
    assert.equal(record.snapshots.after, "final\n");
    assert.equal(record.snapshots.diffs.length, 2);
    assert.deepEqual(record.snapshots.diffs[0].lines, [
      { type: "removed", oldLine: 1, newLine: null, text: "base" },
      { type: "added", oldLine: null, newLine: 1, text: "middle" },
    ]);
    assert.deepEqual(record.snapshots.diff.lines, [
      { type: "removed", oldLine: 1, newLine: null, text: "base" },
      { type: "added", oldLine: null, newLine: 1, text: "final" },
    ]);

    const isolated = await applyFileMutation({
      filePath: target,
      logicalPath: "file.txt",
      content: "other\n",
      operation: "update",
      scopeId: "turn-2",
      mutationRoot,
    });
    assert.notEqual(isolated.mutations[0].id, second.mutations[0].id);
    const isolatedRecord = await readFileMutation({
      mutationRoot,
      mutationId: isolated.mutations[0].id,
    });
    assert.equal(isolatedRecord.snapshots.before, "final\n");
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
    await rm(path.join(mutationRoot, `${firstMutation.mutations[0].id}.json`), { force: true });
    assert.equal(await readFile(first, "utf8"), "first-before\n");
    assert.equal(await readFile(second, "utf8"), "second-before\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rollback removes a file created by a mutation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-mutation-create-rollback-"));
  try {
    const target = path.join(root, "created.txt");
    const mutationRoot = resolveFileMutationRoot(root);
    const result = await applyFileMutation({
      filePath: target,
      logicalPath: "created.txt",
      content: "created\n",
      mutationRoot,
    });
    await rollbackFileMutation({
      mutationRoot,
      mutationId: result.mutations[0].id,
      filePath: target,
    });
    await assert.rejects(stat(target), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
