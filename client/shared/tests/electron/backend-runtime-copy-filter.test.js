/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { clientFilePath as path } from "../../path-resolver.js";
import { shouldCopyBackendRuntimeFile } from "../../scripts/backend-runtime-copy-filter.js";

const workspaceRoot = path.resolve("/repo/model-proxy");

test("backend runtime copy excludes PM2 process state and sockets", () => {
  for (const relativePath of [".pm2/rpc.sock", ".pm2/pub.sock", ".pm2/pm2.pid"]) {
    assert.equal(
      shouldCopyBackendRuntimeFile(workspaceRoot, path.join(workspaceRoot, relativePath)),
      false,
      relativePath,
    );
  }
});

test("backend runtime copy preserves source and prompt files", () => {
  assert.equal(
    shouldCopyBackendRuntimeFile(workspaceRoot, path.join(workspaceRoot, "src/index.js")),
    true,
  );
  assert.equal(
    shouldCopyBackendRuntimeFile(workspaceRoot, path.join(workspaceRoot, "src/prompts/base.md")),
    true,
  );
});
