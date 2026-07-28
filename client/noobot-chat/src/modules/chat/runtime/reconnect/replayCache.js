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

export function normalizeReplayCacheKey(dialogProcessId = "", sessionId = "", turnScopeId = "") {
  const turnKey = createTurnKey({ sessionId, turnScopeId });
  if (turnKey) return turnKey;
  const normalizedDpId = _trimStr(dialogProcessId);
  if (normalizedDpId) return normalizedDpId;
  const normalizedSessionId = _trimStr(sessionId);
  return normalizedSessionId ? `__session__${normalizedSessionId}` : "__session__unknown";
}

export function markReconnectSequenceApplied(
  appliedReconnectSequenceByTurnKey,
  dialogProcessId = "",
  sequence = 0,
  {
    sessionId = "",
    turnScopeId = "",
    appliedEventKindsByTurnKey = null,
    eventKindsAtSequence = [],
  } = {},
) {
  const normalizedDpId = _trimStr(dialogProcessId);
  const replayKey = createTurnKey({ sessionId, turnScopeId }) || normalizedDpId;
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
  if (normalizedDpId) {
    const legacySequence = Number(appliedReconnectSequenceByTurnKey?.[normalizedDpId] || 0);
    if (normalizedSequence > legacySequence) {
      appliedReconnectSequenceByTurnKey[normalizedDpId] = normalizedSequence;
    }
    if (appliedEventKindsByTurnKey) {
      appliedEventKindsByTurnKey[normalizedDpId] = appliedEventKindsByTurnKey[replayKey];
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
        : (keyIdentity || String(replayKey || "").startsWith("__session__") ? "" : String(replayKey || "")),
      turnScopeId: keyIdentity?.turnScopeId || (turnScopeIds.size === 1 ? [...turnScopeIds][0] : ""),
      replayMessages: normalizedReplayMessages,
    };
  });
}
