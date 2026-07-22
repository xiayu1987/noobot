/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { _trimStr } from "./utils";
import {
  createTurnKey,
  parseTurnKey,
  resolveTurnIdentity,
} from "../chatEngine/turnIdentity";

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
  { sessionId = "", turnScopeId = "" } = {},
) {
  const normalizedDpId = _trimStr(dialogProcessId);
  const replayKey = createTurnKey({ sessionId, turnScopeId }) || normalizedDpId;
  const normalizedSequence = Number(sequence || 0);
  if (!replayKey || normalizedSequence <= 0) return;
  const lastAppliedSeq = Number(appliedReconnectSequenceByTurnKey?.[replayKey] || 0);
  if (normalizedSequence > lastAppliedSeq) {
    appliedReconnectSequenceByTurnKey[replayKey] = normalizedSequence;
  }
  // Legacy reconnect envelopes can omit turnScopeId even when they belong to
  // the currently active canonical turn. Keep the execution-chain cursor as a
  // read-only compatibility alias so those envelopes cannot replay facts that
  // were already consumed by a TurnKey batch. It is never used for ownership.
  if (normalizedDpId) {
    const legacySequence = Number(appliedReconnectSequenceByTurnKey?.[normalizedDpId] || 0);
    if (normalizedSequence > legacySequence) {
      appliedReconnectSequenceByTurnKey[normalizedDpId] = normalizedSequence;
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
      // A batch can target a turn only when every scoped event agrees. Never
      // guess across continuation turns which intentionally reuse a process id.
      turnScopeId: keyIdentity?.turnScopeId || (turnScopeIds.size === 1 ? [...turnScopeIds][0] : ""),
      replayMessages: normalizedReplayMessages,
    };
  });
}
