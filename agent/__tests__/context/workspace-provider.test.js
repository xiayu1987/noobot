/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resolveWorkspaceDirectories } from "../../src/context/providers/workspace-provider.js";

test("workspace directory context exposes attachment storage in the logical workspace view", async () => {
  const basePath = await mkdtemp(path.join(os.tmpdir(), "noobot-workspace-directories-"));
  await Promise.all([
    mkdir(path.join(basePath, "runtime", "attach", "scoped"), { recursive: true }),
    mkdir(path.join(basePath, "runtime", "ops_workdir"), { recursive: true }),
    mkdir(path.join(basePath, "skills"), { recursive: true }),
  ]);

  const directories = await resolveWorkspaceDirectories(basePath);

  assert.equal(directories.includes("runtime"), true);
  assert.equal(directories.includes("runtime/ops_workdir"), true);
  assert.equal(directories.includes("skills"), true);
  assert.equal(directories.includes("runtime/attach"), true);
});
