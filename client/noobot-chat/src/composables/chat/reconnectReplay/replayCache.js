/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { _trimStr } from "./utils";

export function normalizeReplayCacheKey(dialogProcessId = "", sessionId = "") {
  const normalizedDpId = _trimStr(dialogProcessId);
  if (normalizedDpId) return normalizedDpId;
  const normalizedSessionId = _trimStr(sessionId);
  return normalizedSessionId ? `__session__${normalizedSessionId}` : "__session__unknown";
}

export function markReconnectSequenceApplied(
  appliedReconnectSeqByDialogProcessId,
  dialogProcessId = "",
  sequence = 0,
) {
  const normalizedDpId = _trimStr(dialogProcessId);
  const normalizedSequence = Number(sequence || 0);
  if (!normalizedDpId || normalizedSequence <= 0) return;
  const lastAppliedSeq = Number(appliedReconnectSeqByDialogProcessId?.[normalizedDpId] || 0);
  if (normalizedSequence > lastAppliedSeq) {
    appliedReconnectSeqByDialogProcessId[normalizedDpId] = normalizedSequence;
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
    const turnScopeIds = new Set(
      normalizedReplayMessages
        .map(({ data } = {}) => _trimStr(data?.turnScopeId || data?.messageEvent?.turnScopeId))
        .filter(Boolean),
    );
    return {
      replayKey,
      dialogProcessId: String(replayKey || "").startsWith("__session__") ? "" : String(replayKey || ""),
      // A batch can target a turn only when every scoped event agrees. Never
      // guess across continuation turns which intentionally reuse a process id.
      turnScopeId: turnScopeIds.size === 1 ? [...turnScopeIds][0] : "",
      replayMessages: normalizedReplayMessages,
    };
  });
}
