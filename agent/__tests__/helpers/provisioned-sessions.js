/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import os from "node:os";
import path from "node:path";
import { access, mkdtemp, rm } from "node:fs/promises";

import { withRuntimeEventsEnv } from "@noobot/runtime-events/testing";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { createSessionFacade } from "../../src/session/index.js";
import { createTestSessionServices, provisionTestSession } from "./session-services.js";
import { initializeUserWorkspace } from "./user-workspace.js";

export async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function withProvisionedSessions({ userId, sessionIds }, fn) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-running-delete-"));
  try {
    await withRuntimeEventsEnv({ workspaceRoot }, async () => {
      await initializeUserWorkspace(workspaceRoot, userId);
      const runtime = createTestSessionServices({ workspaceRoot });
      const repository = runtime.repositories.sessionRepository;
      const scopes = {};
      for (const sessionId of sessionIds) {
        await provisionTestSession(runtime, { userId, sessionId, caller: SESSION_CALLER.USER });
        scopes[sessionId] = await repository.requireSessionScope(
          userId,
          sessionId,
          repository.treePersistenceContext(userId, sessionId),
        );
      }
      await fn({ runtime, session: createSessionFacade(runtime), scopes });
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}
