/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createTurnKey } from "../engine/turnIdentity.js";

export function normalizeReplayCacheKey(sessionId, turnScopeId) {
  return createTurnKey({ sessionId, turnScopeId });
}

export function takeReplayCacheGroupsForSession(replayCache, sessionId) {
  const sessionReplayCache = replayCache[sessionId];
  if (!sessionReplayCache) return [];
  delete replayCache[sessionId];
  return Object.values(sessionReplayCache);
}
