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
      // A snapshot is only discovery metadata for terminal Turns. Schedule the
      // authoritative read independently of whether its non-terminal runtime
      // projection is applicable (older snapshots may intentionally lack the
      // complete terminal commit required by the current protocol).
      const candidates = [snapshot.activeTurn, ...(Array.isArray(snapshot.recentTerminalTurns) ? snapshot.recentTerminalTurns : [])]
        .filter((turn) => {
          // Refresh has no guarantee that the snapshot was captured after the
          // backend committed the terminal state.  The active Turn is therefore
          // also a discovery trigger; the terminal service decides whether it
          // is already resolved and supplies retry guidance otherwise.
          if (!turn || !getMessageTurnScopeId(turn) && !turn?.turnScopeId) return false;
          return turn === snapshot.activeTurn || isAuthoritativeTerminalState(turn?.state);
        })
        .sort((left, right) => Number(right?.sequence || right?.revision || 0) - Number(left?.sequence || left?.revision || 0));
      // Terminal discovery must not depend on the selected Session view being
      // ready. During refresh the summary can arrive before activeSession has
      // resolved its backend identity; gating here would permanently lose the
      // only trigger for the authoritative terminal read.
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
      // Apply the snapshot before the second local observation. A terminal GET
      // can finish while the refresh reducer is still materializing the
      // Session bucket; the coordinator will reuse its cached response and
      // project it now that the canonical bucket is available.
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
    // Some refresh/detail responses contain only persisted turnStatuses. These
    // rows are discovery metadata, never runtime facts: feed the newest terminal
    // identity into the same authoritative resolver used by snapshots/realtime.
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


  // Snapshot and persisted status rows are discovery inputs only. Both converge
  // on the same authoritative terminal service and neither writes runtime state.
  for (const sessionItem of sessions.value) {
    hydrateSessionLifecycle(sessionItem);
    chatStore.pruneTerminalTurns({
      sessionId: sessionRuntimeId(sessionItem),
      referencedTurnScopeIds: (sessionItem?.messages || []).map(getMessageTurnScopeId).filter(Boolean),
    });
  }

  // Reconcile replacements, refreshes, reconnects, and non-active sessions
  // from the lifecycle protocol; message order is never consulted.
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
