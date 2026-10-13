/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WORKSPACE_RUNTIME_DIRECTORIES } from "@noobot/workspace-protocol/layout";
import { withRuntimeEventsEnv } from "@noobot/runtime-events/testing";

export { persistSession, sessionDirPath } from "@noobot/runtime-events/testing";
export { withRuntimeEventsEnv };

export async function withRuntimeEventsRoot(prefix, operation) {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await withRuntimeEventsEnv({ workspaceRoot }, () => operation(workspaceRoot));
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
}

export async function initializeUserRuntimeDirectories(workspaceRoot, userId) {
  for (const relativePath of WORKSPACE_RUNTIME_DIRECTORIES) {
    await fs.mkdir(path.join(workspaceRoot, userId, relativePath), { recursive: true });
  }
}
