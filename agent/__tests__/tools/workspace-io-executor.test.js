/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { resolveToolExecutionPolicy } from "@noobot/execution-isolation-protocol";
import { createWorkspaceIoExecutor } from "../../src/tools/core/workspace-io-executor.js";

function workspacePolicy() {
  return resolveToolExecutionPolicy({ toolName: "write_file", globalConfig: {} });
}

test("workspace atomic writes use the canonical transient rename policy", async () => {
  const files = new Map();
  const removed = [];
  let renameAttempts = 0;
  const executor = createWorkspaceIoExecutor({
    executionPolicy: workspacePolicy(),
    atomicRenameRetryDelaysMs: [1],
    platform: "win32",
    fileSystem: {
      mkdir: async () => {},
      writeFile: async (filePath, content) => files.set(filePath, content),
      rename: async (source, target) => {
        renameAttempts += 1;
        if (renameAttempts === 1) {
          const error = new Error("file is temporarily locked");
          error.code = "EPERM";
          throw error;
        }
        files.set(target, files.get(source));
        files.delete(source);
      },
      rm: async (filePath) => {
        removed.push(filePath);
        files.delete(filePath);
      },
    },
  });

  await executor.writeText("C:/workspace/project/a.txt", "patched-line\n");

  assert.equal(renameAttempts, 2);
  assert.equal(files.get("C:/workspace/project/a.txt"), "patched-line\n");
  assert.deepEqual(removed, []);
});

for (const platform of ["linux", "darwin"]) {
  test(`workspace atomic writes do not retry permission errors on ${platform}`, async () => {
    let renameAttempts = 0;
    const removed = [];
    const executor = createWorkspaceIoExecutor({
      executionPolicy: workspacePolicy(),
      atomicRenameRetryDelaysMs: [1, 1],
      platform,
      fileSystem: {
        mkdir: async () => {},
        writeFile: async () => {},
        rename: async () => {
          renameAttempts += 1;
          const error = new Error("permission denied");
          error.code = "EACCES";
          throw error;
        },
        rm: async (filePath) => removed.push(filePath),
      },
    });

    await assert.rejects(
      () => executor.writeText("/workspace/project/a.txt", "content"),
      /permission denied/,
    );
    assert.equal(renameAttempts, 1);
    assert.equal(removed.length, 1);
  });
}

test("workspace atomic writes fail immediately for non-transient rename errors", async () => {
  let renameAttempts = 0;
  const removed = [];
  const executor = createWorkspaceIoExecutor({
    executionPolicy: workspacePolicy(),
    atomicRenameRetryDelaysMs: [1, 1],
    fileSystem: {
      mkdir: async () => {},
      writeFile: async () => {},
      rename: async () => {
        renameAttempts += 1;
        const error = new Error("invalid target");
        error.code = "EINVAL";
        throw error;
      },
      rm: async (filePath) => removed.push(filePath),
    },
  });

  await assert.rejects(
    () => executor.writeText("C:/workspace/project/a.txt", "content"),
    /invalid target/,
  );
  assert.equal(renameAttempts, 1);
  assert.equal(removed.length, 1);
});
