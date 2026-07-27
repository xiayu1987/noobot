/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { watch } from "vue";
import { getMessageTurnScopeId } from "../../infra/messageIdentity";
import { logThinkingReplayDebug } from "../debug/thinkingReplayDebugLogger";
import { isAuthoritativeTerminalState, isLegacyTerminalDiscoveryState } from "../sessionRunStateMachine";
import { sessionRuntimeId } from "../sessionRunStateMachine/turnRuntimeRegistry";

export function installSessionLifecycleHydration({ sessions, activeSessionId, chatStore, scheduleTerminalResolution }) {
  function hydrateSessionLifecycle(sessionItem) {
    const snapshot = sessionItem?.turnLifecycleSnapshot;
    const sessionId = sessionRuntimeId(sessionItem);
    const timingResult = chatStore.applyTurnTimingSnapshot({
      sessionId,
      turnTimings: Array.isArray(sessionItem?.turnTimings) ? sessionItem.turnTimings : [],
    });
    logThinkingReplayDebug("frontend.lifecycle.hydrateStarted", {
      requestedSessionId: String(sessionItem?.sessionId || "").trim(),
      runtimeSessionId: sessionId,
      snapshotSessionId: String(snapshot?.sessionId || "").trim(),
      snapshotSequence: Number(snapshot?.sequence || 0),
      activeTurnScopeId: String(snapshot?.activeTurnScopeId || "").trim(),
      recentTerminalCount: Array.isArray(snapshot?.recentTerminalTurns) ? snapshot.recentTerminalTurns.length : 0,
      turnTimingsCount: Array.isArray(sessionItem?.turnTimings) ? sessionItem.turnTimings.length : 0,
      timingSnapshotApplied: timingResult?.applied === true,
      timingSnapshotReason: timingResult?.reason || "",
    });
    if (snapshot && typeof snapshot === "object") {
      const candidates = [snapshot.activeTurn, ...(Array.isArray(snapshot.recentTerminalTurns) ? snapshot.recentTerminalTurns : [])]
        .filter((turn) => {
          if (!turn || !getMessageTurnScopeId(turn) && !turn?.turnScopeId) return false;
          return turn === snapshot.activeTurn || isAuthoritativeTerminalState(turn?.state);
        })
        .sort((left, right) => Number(right?.sequence || right?.revision || 0) - Number(left?.sequence || left?.revision || 0));
      if (sessionId && candidates[0]) {
        const turn = candidates[0];
        scheduleTerminalResolution(sessionId, getMessageTurnScopeId(turn) || turn?.turnScopeId, {
          ...turn,
          source: turn === snapshot.activeTurn ? "snapshot_active_turn" : "snapshot_terminal_turn",
        });
      }
      const result = chatStore.applyTurnLifecycleSnapshot(snapshot);
      logThinkingReplayDebug("frontend.lifecycle.hydrateApplied", {
        requestedSessionId: String(sessionItem?.sessionId || "").trim(),
        runtimeSessionId: sessionId,
        snapshotSessionId: String(snapshot?.sessionId || "").trim(),
        candidateTurnScopeId: String(candidates[0]?.turnScopeId || "").trim(),
        candidateState: String(candidates[0]?.state || "").trim(),
        candidateStartedAt: candidates[0]?.startedAt || "",
        candidateFinishedAt: candidates[0]?.finishedAt || "",
        resultApplied: result?.applied === true,
        resultReason: result?.reason || "",
      });
      if (sessionId && candidates[0]) {
        const turn = candidates[0];
        const postHydrateMetadata = {
          ...turn,
          source: "snapshot_post_hydrate",
        };
        Promise.resolve().then(() => scheduleTerminalResolution(
          sessionId,
          getMessageTurnScopeId(turn) || turn?.turnScopeId,
          postHydrateMetadata,
        ));
      }
      return result;
    }
    const terminalStatus = (Array.isArray(sessionItem?.turnStatuses) ? sessionItem.turnStatuses : [])
      .filter((turn) => isLegacyTerminalDiscoveryState(turn?.status || turn?.state))
      .sort((left, right) => {
        const versionDelta = Number(right?.sequence || right?.revision || 0)
          - Number(left?.sequence || left?.revision || 0);
        if (versionDelta) return versionDelta;
        return String(right?.updatedAt || right?.createdAt || "")
          .localeCompare(String(left?.updatedAt || left?.createdAt || ""));
      })[0];
    if (sessionId && terminalStatus) {
      scheduleTerminalResolution(
        sessionId,
        getMessageTurnScopeId(terminalStatus) || terminalStatus?.turnScopeId,
        { ...terminalStatus, source: "turn_status_discovery" },
      );
      return { applied: false, reason: "terminal_resolution_scheduled" };
    }
    return { applied: false, reason: "terminal_discovery_missing" };
  }


  for (const sessionItem of sessions.value) {
    hydrateSessionLifecycle(sessionItem);
    chatStore.pruneTerminalTurns({
      sessionId: sessionRuntimeId(sessionItem),
      referencedTurnScopeIds: (sessionItem?.messages || []).map(getMessageTurnScopeId).filter(Boolean),
    });
  }

  watch(
    [sessions, activeSessionId],
    ([sessionItems]) => {
      for (const sessionItem of Array.isArray(sessionItems) ? sessionItems : []) {
        hydrateSessionLifecycle(sessionItem);
        chatStore.pruneTerminalTurns({
          sessionId: sessionRuntimeId(sessionItem),
          referencedTurnScopeIds: (sessionItem?.messages || []).map(getMessageTurnScopeId).filter(Boolean),
        });
      }
    },
    { deep: true },
  );

}
