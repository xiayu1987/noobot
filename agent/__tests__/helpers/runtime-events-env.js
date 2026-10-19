/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  initializeSessionTree,
  persistSession,
  useRuntimeEventsEnv,
} from "@noobot/runtime-events/testing";
import { SESSION_CALLER } from "@noobot/shared/session-caller";

export {
  initializeSessionTree,
  persistSession,
  useRuntimeEventsEnv,
} from "@noobot/runtime-events/testing";

export async function useRuntimeEventsUserWorkspace(t, userId) {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-runtime-events-"));
  t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
  useRuntimeEventsEnv(t, { workspaceRoot });
  await initializeSessionTree(workspaceRoot, userId);
  return workspaceRoot;
}

export async function persistChildSessionFixture(workspaceRoot, userId = "u1") {
  await initializeSessionTree(workspaceRoot, userId);
  await persistSession(workspaceRoot, userId, {
    sessionId: "p1",
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
  });
  const sessionDir = await persistSession(workspaceRoot, userId, {
    sessionId: "s1",
    parentSessionId: "p1",
    caller: SESSION_CALLER.USER,
  });
  return path.join(sessionDir, "events");
}
