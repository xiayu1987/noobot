/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { watch } from "vue";
import { getMessageTurnScopeId } from "../../model/messageIdentity.js";
import { logThinkingReplayDebug } from "../../../debug/loggers/thinkingReplayDebugLogger.js";
import { sessionRuntimeId } from "../run-state-machine/turnRuntimeRegistry.js";

export function installSessionLifecycleHydration({
  sessions,
  activeSessionId,
  chatStore,
  scheduleTerminalResolution,
}) {
  function hydrateSessionLifecycle(sessionItem) {
    const snapshot = sessionItem?.turnLifecycleSnapshot;
    const sessionId = sessionRuntimeId(sessionItem);
    const timingResult = chatStore.applyTurnTimingSnapshot({
      sessionId,
      turnTimings: Array.isArray(sessionItem?.turnTimings) ? sessionItem.turnTimings : [],
    });
    logThinkingReplayDebug("frontend.lifecycle.hydrateStarted", () => ({
      requestedSessionId: String(sessionItem?.sessionId || "").trim(),
      runtimeSessionId: sessionId,
      snapshotSessionId: String(snapshot?.sessionId || "").trim(),
      snapshotSequence: Number(snapshot?.sequence || 0),
      activeTurnScopeId: String(snapshot?.activeTurnScopeId || "").trim(),
      recentTerminalCount: Array.isArray(snapshot?.recentTerminalTurns) ? snapshot.recentTerminalTurns.length : 0,
      replacedTurnScopeIds: (Array.isArray(snapshot?.replacedTurns) ? snapshot.replacedTurns : [])
        .map((replacement) => String(replacement?.turnScopeId || "").trim())
        .filter(Boolean),
      turnTimingsCount: Array.isArray(sessionItem?.turnTimings) ? sessionItem.turnTimings.length : 0,
      timingSnapshotApplied: timingResult?.applied === true,
      timingSnapshotReason: timingResult?.reason || "",
    }));
    if (snapshot && typeof snapshot === "object") {
      const result = chatStore.applyTurnLifecycleSnapshot(snapshot);
      const activeTurn = snapshot.activeTurn;
      const activeTurnState = String(activeTurn?.state || "").trim().toLowerCase();
      const activeTurnScopeId = String(activeTurn?.turnScopeId || snapshot.activeTurnScopeId || "").trim();
      const isTerminal = ["completed", "stop_completed", "failed", "processing_failed", "action_failed", "stopped"].includes(activeTurnState);
      // A non-terminal authoritative activeTurn is the only legal source for
      // terminal discovery after refresh. Never inspect turnStatuses or
      // persisted message status here.
      if (result?.applied === true && activeTurn && activeTurnScopeId && !isTerminal) {
        scheduleTerminalResolution?.(sessionId, activeTurnScopeId, {
          source: "authoritative_active_turn_hydration",
          revision: activeTurn.revision ?? snapshot.revision,
          sequence: activeTurn.sequence ?? snapshot.sequence,
          state: activeTurn.state,
          phase: activeTurn.phase,
          executionState: activeTurn.executionState,
          startedAt: activeTurn.startedAt,
        });
      }
      logThinkingReplayDebug("frontend.lifecycle.hydrateApplied", () => ({
        requestedSessionId: String(sessionItem?.sessionId || "").trim(),
        runtimeSessionId: sessionId,
        snapshotSessionId: String(snapshot?.sessionId || "").trim(),
        resultApplied: result?.applied === true,
        resultReason: result?.reason || "",
        replacedTurnScopeIds: result?.replacedTurnScopeIds || [],
        removedTurnScopeIds: result?.replacementDeletion?.removedTurnScopeIds || [],
        confirmedTurnScopeIds: result?.replacementDeletion?.confirmedTurnScopeIds || [],
      }));
      return result;
    }
    return { applied: false, reason: "authoritative_snapshot_missing" };
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
