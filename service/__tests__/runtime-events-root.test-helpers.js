/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before } from "node:test";
import { WORKSPACE_RUNTIME_DIRECTORIES } from "@noobot/workspace-protocol/layout";
import { flushRuntimeEvents } from "@noobot/runtime-events";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import {
  applyRuntimeEventsEnv,
  initializeSessionTree,
  persistSession,
  withRuntimeEventsEnv,
} from "@noobot/runtime-events/testing";

export {
  initializeSessionTree,
  persistSession,
  sessionDirPath,
} from "@noobot/runtime-events/testing";
export { withRuntimeEventsEnv };

export async function withRuntimeEventsRoot(prefix, operation) {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await withRuntimeEventsEnv({ workspaceRoot }, async () => {
      try {
        return await operation(workspaceRoot);
      } finally {
        await flushRuntimeEvents();
      }
    });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
}

export async function initializeUserRuntimeDirectories(workspaceRoot, userId) {
  for (const relativePath of WORKSPACE_RUNTIME_DIRECTORIES) {
    await fs.mkdir(path.join(workspaceRoot, userId, relativePath), { recursive: true });
  }
  await initializeSessionTree(workspaceRoot, userId);
}

export function useProvisionedRuntimeEventsWorkspace(
  userIds,
  rootSessionIdsByUser = {},
  prepareWorkspace,
) {
  let workspaceRoot;
  let restoreRuntimeEventsEnv;
  before(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-service-workspace-"));
    restoreRuntimeEventsEnv = applyRuntimeEventsEnv({ workspaceRoot });
    for (const userId of userIds) {
      await initializeUserRuntimeDirectories(workspaceRoot, userId);
    }
    for (const [userId, sessionIds] of Object.entries(rootSessionIdsByUser)) {
      if (!userIds.includes(userId)) throw new Error(`Unprovisioned fixture user: ${userId}`);
      for (const sessionId of sessionIds) {
        await persistSession(workspaceRoot, userId, {
          sessionId,
          parentSessionId: "",
          caller: SESSION_CALLER.USER,
        });
      }
    }
    if (prepareWorkspace) await prepareWorkspace(workspaceRoot);
  });
  after(async () => {
    try {
      await flushRuntimeEvents();
    } finally {
      restoreRuntimeEventsEnv();
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });
}
