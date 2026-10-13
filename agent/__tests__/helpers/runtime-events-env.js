/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { persistSession } from "@noobot/runtime-events/testing";

export { persistSession, useRuntimeEventsEnv } from "@noobot/runtime-events/testing";

export async function persistChildSessionFixture(workspaceRoot, userId = "u1") {
  await persistSession(workspaceRoot, userId, "p1");
  const sessionDir = await persistSession(workspaceRoot, userId, "s1", "p1");
  return path.join(sessionDir, "events");
}
