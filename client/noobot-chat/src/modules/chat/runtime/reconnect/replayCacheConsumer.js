/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { takeReplayCacheGroupsForSession } from "./replayCache.js";

export async function consumeReconnectReplayCacheForSession({
  replayCache,
  sessionId,
  applyReconnectMessagesToActiveSession,
}) {
  for (const replayMessages of takeReplayCacheGroupsForSession(replayCache, sessionId)) {
    await applyReconnectMessagesToActiveSession(replayMessages, {
      turnScopeId: replayMessages[0].identity.turnScopeId,
    });
  }
}
