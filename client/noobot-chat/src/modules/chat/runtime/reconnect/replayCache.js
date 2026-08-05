/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { _trimStr } from "./utils.js";
import {
  createTurnKey,
  parseTurnKey,
  resolveTurnIdentity,
} from "../engine/turnIdentity.js";

export function normalizeReplayCacheKey(sessionId = "", turnScopeId = "") {
  return createTurnKey({ sessionId, turnScopeId });
}

export function markReconnectSequenceApplied(
  appliedReconnectSequenceByTurnKey,
  sequence = 0,
  {
    sessionId = "",
    turnScopeId = "",
    appliedEventKindsByTurnKey = null,
    eventKindsAtSequence = [],
  } = {},
) {
  const replayKey = createTurnKey({ sessionId, turnScopeId });
  const normalizedSequence = Number(sequence || 0);
  if (!replayKey || normalizedSequence <= 0) return;
  const lastAppliedSeq = Number(appliedReconnectSequenceByTurnKey?.[replayKey] || 0);
  if (normalizedSequence > lastAppliedSeq) {
    appliedReconnectSequenceByTurnKey[replayKey] = normalizedSequence;
  }
  if (appliedEventKindsByTurnKey && replayKey) {
    const previousBoundary = appliedEventKindsByTurnKey[replayKey];
    const previousSequence = Number(previousBoundary?.sequence || 0);
    const previousKinds = previousSequence === normalizedSequence && Array.isArray(previousBoundary?.eventKinds)
      ? previousBoundary.eventKinds
      : [];
    if (normalizedSequence >= previousSequence) {
      appliedEventKindsByTurnKey[replayKey] = {
        sequence: normalizedSequence,
        sequenceDomain: "transport",
        eventKinds: Array.from(new Set([
          ...previousKinds,
          ...(Array.isArray(eventKindsAtSequence) ? eventKindsAtSequence : []),
        ].map((value) => _trimStr(value)).filter(Boolean))).sort(),
      };
    }
  }
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
    const identities = normalizedReplayMessages.map(({ data } = {}) =>
      resolveTurnIdentity(data, { sessionId: normalizedSessionId }),
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
