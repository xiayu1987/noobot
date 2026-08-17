/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createTurnKey,
  parseTurnKey,
  resolveTurnIdentity,
} from "../engine/turnIdentity.js";
import { _trimStr } from "./utils.js";

export function normalizeReplayCacheKey(sessionId = "", turnScopeId = "") {
  return createTurnKey({ sessionId, turnScopeId });
}

export function takeReplayCacheGroupsForSession(replayCache, sessionId = "") {
  const normalizedSessionId = _trimStr(sessionId);
  if (!normalizedSessionId) return [];
  const sessionReplayCache = replayCache?.[normalizedSessionId];
  if (!sessionReplayCache) return [];
  const replayGroups = Object.entries(sessionReplayCache);
  delete replayCache[normalizedSessionId];
  return replayGroups.map(([replayKey, replayMessages]) => {
    const normalizedReplayMessages = Array.isArray(replayMessages) ? replayMessages : [];
    const keyIdentity = parseTurnKey(replayKey);
    if (!keyIdentity) return null;
    const identities = normalizedReplayMessages.map((envelope) =>
      resolveTurnIdentity(envelope, { sessionId: normalizedSessionId }),
    );
    const turnScopeIds = new Set(
      identities
        .map((identity) => identity.turnScopeId)
        .filter(Boolean),
    );
    const dialogProcessIds = new Set(identities.map((identity) => identity.dialogProcessId).filter(Boolean));
    return {
      replayKey,
      dialogProcessId: dialogProcessIds.size === 1
        ? [...dialogProcessIds][0]
        : "",
      turnScopeId: keyIdentity.turnScopeId,
      replayMessages: normalizedReplayMessages,
    };
  }).filter(Boolean);
}
