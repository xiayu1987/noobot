/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { projectSessionRunEvent } from "@noobot/session-protocol/runtime-event";

export function sessionRunEventFixture(event, current) {
  return projectSessionRunEvent({
    sessionId: "s1",
    turnScopeId: "turn-1",
    dialogProcessId: "dialog-1",
    timestamp: 1767225600000,
    updatedAtMs: 1767225600000,
    updatedAt: "2026-01-01T00:00:00.000Z",
    seq: (current?.lifecycleSeq ?? 0) + 1,
    revision: (current?.revision ?? 0) + 1,
    ...event,
  });
}
