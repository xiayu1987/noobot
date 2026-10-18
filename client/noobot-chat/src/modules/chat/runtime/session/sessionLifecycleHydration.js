/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { watch } from "vue";
import { getMessageTurnScopeId } from "../../model/messageIdentity.js";
import { logThinkingReplayDebug } from "../../../debug/loggers/thinkingReplayDebugLogger.js";
import { sessionRuntimeId } from "../run-state-machine/turnRuntimeRegistry.js";
import { isLegacyTerminalDiscoveryState } from "../run-state-machine/constants.js";
import { text, isObjectLike } from "@noobot/shared/value";

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
      requestedSessionId: text(sessionItem?.sessionId),
      runtimeSessionId: sessionId,
      snapshotSessionId: text(snapshot?.sessionId),
      snapshotSequence: Number(snapshot?.sequence || 0),
      activeTurnScopeId: text(snapshot?.activeTurnScopeId),
      recentTerminalCount: Array.isArray(snapshot?.recentTerminalTurns)
        ? snapshot.recentTerminalTurns.length
        : 0,
      replacedTurnScopeIds: (Array.isArray(snapshot?.replacedTurns) ? snapshot.replacedTurns : [])
        .map((replacement) => text(replacement?.turnScopeId))
        .filter(Boolean),
      turnTimingsCount: Array.isArray(sessionItem?.turnTimings)
        ? sessionItem.turnTimings.length
        : 0,
      timingSnapshotApplied: timingResult?.applied === true,
      timingSnapshotReason: timingResult?.reason || "",
    }));
    if (isObjectLike(snapshot)) {
      const result = chatStore.applyTurnLifecycleSnapshot(snapshot);
      const activeTurn = snapshot.activeTurn;
      const activeTurnState = text(activeTurn?.state).toLowerCase();
      const activeTurnScopeId = text(activeTurn?.turnScopeId || snapshot.activeTurnScopeId);
      const isTerminal = isLegacyTerminalDiscoveryState(activeTurnState);

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
        requestedSessionId: text(sessionItem?.sessionId),
        runtimeSessionId: sessionId,
        snapshotSessionId: text(snapshot?.sessionId),
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

  function reconcileSession(sessionItem) {
    hydrateSessionLifecycle(sessionItem);
    chatStore.pruneTerminalTurns({
      sessionId: sessionRuntimeId(sessionItem),
      referencedTurnScopeIds: (sessionItem?.messages || [])
        .map(getMessageTurnScopeId)
        .filter(Boolean),
    });
  }

  for (const sessionItem of sessions.value) reconcileSession(sessionItem);

  watch(
    () => {
      activeSessionId.value;
      const sessionItems = Array.isArray(sessions.value) ? sessions.value : [];
      return sessionItems.map((sessionItem) => ({
        sessionItem,
        runtimeSessionId: sessionRuntimeId(sessionItem),
        turnLifecycleSnapshot: sessionItem?.turnLifecycleSnapshot,
        turnTimings: sessionItem?.turnTimings,
        turnScopeIdsSignature: (sessionItem?.messages || [])
          .map(getMessageTurnScopeId)
          .join("\u0000"),
      }));
    },
    (entries) => {
      for (const entry of entries) reconcileSession(entry.sessionItem);
    },
  );
}
