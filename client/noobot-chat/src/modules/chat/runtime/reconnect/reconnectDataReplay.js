/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  findRecoverableReconnectSessionId,
} from "../../model/reconnectReplayModel.js";
import { _trimStr } from "./utils.js";
import { normalizeTurnMeta } from "../../model/messageIdentity.js";
import {
  isPendingInteractionReplay,
  replayEventTail,
  validateReplayBatch,
} from "@noobot/event-protocol";
import { validateTurnLifecycleSnapshot } from "@noobot/session-protocol";
import {
  logStateMachineDebug,
  summarizeTurnLifecycleSnapshot,
} from "../../../debug/loggers/stateMachineLogger.js";

function hasValidTurnLifecycleSnapshot(sessionEntry = {}) {
  const snapshot = sessionEntry?.replayBatch?.snapshot?.payload;
  return Boolean(snapshot && typeof snapshot === "object" && validateTurnLifecycleSnapshot(snapshot).valid);
}

function resolveAuthoritativeActiveTurn(sessionEntry = {}) {
  const sessionId = _trimStr(sessionEntry?.sessionId);
  const authoritativeRun = sessionEntry?.replayBatch?.snapshot?.payload?.activeTurn;
  const authoritativeRunMeta = normalizeTurnMeta({ ...authoritativeRun, sessionId });
  const hasConsistentAuthoritativeRun =
    _trimStr(authoritativeRunMeta.sessionId) === sessionId &&
    Boolean(_trimStr(authoritativeRunMeta.turnScopeId));
  if (hasConsistentAuthoritativeRun) {
    return {
      ...authoritativeRun,
      authoritativeSnapshot: true,
      sessionId: authoritativeRunMeta.sessionId,
      dialogProcessId: authoritativeRunMeta.dialogProcessId,
      turnScopeId: authoritativeRunMeta.turnScopeId,
    };
  }
  return null;
}

export async function applyReconnectDataReplay({
  reconnectData,
  ensureReconnectSessionActive,
  isCurrentActiveSession,
  reconcileSessionState,
  hydrateActiveSessionBeforeReplay,
  applyTurnLifecycleEnvelope,
  applyTurnLifecycleSnapshot,
  applyPendingInteraction,
} = {}) {
  if (
    "cacheExpired" in (reconnectData || {}) ||
    "expiredDialogProcessIds" in (reconnectData || {}) ||
    "suggestion" in (reconnectData || {})
  ) {
    throw new Error("unsupported_reconnect_cache_branch");
  }
  const receivedSessions = Array.isArray(reconnectData?.sessions)
    ? reconnectData.sessions
    : [];
  const invalidProtocolSessions = receivedSessions.filter((sessionEntry) => {
    const batch = sessionEntry?.replayBatch;
    return "dialogProcesses" in (sessionEntry || {}) ||
      !batch || validateReplayBatch(batch).valid !== true;
  });
  const invalidSessions = invalidProtocolSessions;
  const reconnectSessions = receivedSessions.filter(
    (sessionEntry) => !invalidProtocolSessions.includes(sessionEntry),
  );
  logStateMachineDebug("stateMachine.reconnect.data.planned", () => ({
    receivedSessionCount: receivedSessions.length,
    validSessionCount: reconnectSessions.length,
    invalidSessionCount: invalidSessions.length,
    lifecycleEventCount: reconnectSessions.reduce(
      (count, sessionEntry) => count + (Array.isArray(sessionEntry?.replayBatch?.events)
        ? sessionEntry.replayBatch.events.length
        : 0),
      0,
    ),
    lifecycleSnapshotCount: reconnectSessions.filter(hasValidTurnLifecycleSnapshot).length,
  }));
  for (const sessionEntry of invalidSessions) {
    await reconcileSessionState?.({
      sessionId: _trimStr(sessionEntry?.sessionId),
      reason: "invalid_replay_batch",
    });
  }
  // A reconnect transaction has exactly one Authority baseline. Events are a
  // tail after that baseline, never an alternative snapshot source.
  for (const sessionEntry of reconnectSessions) {
    const snapshot = sessionEntry?.replayBatch?.snapshot?.payload;
    if (!snapshot || typeof snapshot !== "object") continue;
    logStateMachineDebug("stateMachine.reconnect.snapshot.received", () => ({
      ...summarizeTurnLifecycleSnapshot(snapshot),
    }));
    const result = applyTurnLifecycleSnapshot?.(snapshot);
    logStateMachineDebug("stateMachine.reconnect.snapshot.applied", () => ({
      ...summarizeTurnLifecycleSnapshot(snapshot),
      applied: result?.applied === true,
      reason: result?.reason || "",
      errorCount: Array.isArray(result?.errors) ? result.errors.length : 0,
    }));
  }
  for (const sessionEntry of reconnectSessions) {
    const snapshot = hasValidTurnLifecycleSnapshot(sessionEntry)
      ? sessionEntry.replayBatch.snapshot.payload
      : null;
    const snapshotSequence = Number(sessionEntry?.replayBatch?.snapshotSequence || 0);
    const lifecycleEvents = Array.isArray(sessionEntry?.replayBatch?.events)
      ? sessionEntry.replayBatch.events
      : [];
    const replayResult = replayEventTail({
      snapshotSequence,
      orderingDomain: sessionEntry.replayBatch.ordering.domain,
      orderingScopeId: sessionEntry.replayBatch.ordering.scopeId,
      events: lifecycleEvents,
      apply: () => {},
    });
    if (!replayResult.applied) {
      await reconcileSessionState?.({
        sessionId: _trimStr(sessionEntry?.sessionId),
        reason: replayResult.reason,
      });
      continue;
    }
    if (!lifecycleEvents.length) continue;
    const sessionId = _trimStr(sessionEntry?.sessionId);
    logStateMachineDebug("stateMachine.reconnect.lifecycleReplay.before", () => ({
      sessionId,
      snapshotSequence,
      eventCount: lifecycleEvents.length,
      firstSequence: Number(lifecycleEvents[0]?.ordering?.sequence || 0),
      lastSequence: Number(lifecycleEvents.at(-1)?.ordering?.sequence || 0),
    }));
    const results = [];
    for (const envelope of lifecycleEvents) {
      const result = await applyTurnLifecycleEnvelope?.(envelope);
      results.push(Array.isArray(result) ? result[0] : result);
    }
    logStateMachineDebug("stateMachine.reconnect.lifecycleReplay.after", () => ({
      sessionId,
      snapshotSequence,
      eventCount: lifecycleEvents.length,
      appliedCount: results.filter((result) => result?.applied === true).length,
      rejectedCount: results.filter((result) => result?.applied === false).length,
      reasons: [...new Set(results.map((result) => String(result?.reason || "")).filter(Boolean))],
    }));
  }
  const recoverableSessionId = findRecoverableReconnectSessionId(
    reconnectSessions,
    reconnectData?.currentSessionId,
  );
  const recoverableSessionEntry = reconnectSessions.find(
    (sessionEntry) => _trimStr(sessionEntry?.sessionId) === recoverableSessionId,
  );
  if (recoverableSessionId) {
    logStateMachineDebug("stateMachine.reconnect.activation.before", () => ({
      sessionId: recoverableSessionId,
    }));
    await ensureReconnectSessionActive(recoverableSessionId);
    logStateMachineDebug("stateMachine.reconnect.activation.after", () => ({
      sessionId: recoverableSessionId,
      active: isCurrentActiveSession(recoverableSessionId),
    }));
  }

  for (const sessionEntry of reconnectSessions) {
    const sessionId = _trimStr(sessionEntry?.sessionId);
    if (!sessionId) continue;
    const authoritativeActiveTurn = resolveAuthoritativeActiveTurn(sessionEntry);
    const authoritativeActiveTurnMeta = normalizeTurnMeta(authoritativeActiveTurn || {});
    const hasAuthoritativeActiveTurn = Boolean(authoritativeActiveTurn && authoritativeActiveTurn.state && !["completed", "stop_completed"].includes(authoritativeActiveTurn.state));
    if (hasAuthoritativeActiveTurn && isCurrentActiveSession(sessionId)) {
      logStateMachineDebug("stateMachine.reconnect.hydration.before", () => ({
        sessionId,
        turnScopeId: authoritativeActiveTurnMeta.turnScopeId,
        hasAuthoritativeActiveTurn,
      }));
      const hydrated = await hydrateActiveSessionBeforeReplay?.(sessionId, authoritativeActiveTurn);
      logStateMachineDebug("stateMachine.reconnect.hydration.after", () => ({
        sessionId,
        turnScopeId: authoritativeActiveTurnMeta.turnScopeId,
        hydrated: hydrated === true,
      }));
    }
  }

  // Pending interactions are materialized only after the authoritative
  // session has been activated and hydrated. This keeps the queue projection
  // scoped to the same active session as the replay batch.
  for (const sessionEntry of reconnectSessions) {
    for (const interaction of sessionEntry?.replayBatch?.pendingInteractions || []) {
      if (isPendingInteractionReplay(interaction)) {
        await applyPendingInteraction?.(interaction.payload);
      }
    }
  }


  logStateMachineDebug("stateMachine.reconnect.transaction.complete", () => ({
    sessionId: recoverableSessionId,
    receivedSessionCount: receivedSessions.length,
    validSessionCount: reconnectSessions.length,
    invalidSessionCount: invalidSessions.length,
    recoverableSessionId,
    recoverableTurnScopeId: normalizeTurnMeta(resolveAuthoritativeActiveTurn(recoverableSessionEntry) || {}).turnScopeId,
    authoritativeSnapshotReceivedCount: reconnectSessions.filter(hasValidTurnLifecycleSnapshot).length,
  }));
}
