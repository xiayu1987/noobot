/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  findRecoverableReconnectSessionId,
  resolveDialogProcessIdFromReplay,
  splitReconnectMessagesByTurnIdentity,
} from "../../model/reconnectReplayModel.js";
import { nowMs } from "../../model/timeFields.js";
import { _trimStr } from "./utils.js";
import { normalizeTurnMeta } from "../../model/messageIdentity.js";
import { normalizeReplayCacheKey } from "./replayCache.js";
import { replayEventTail, validateReplayBatch, validateTurnLifecycleSnapshot } from "@noobot/event-protocol";
import {
  logStateMachineDebug,
  summarizeTurnLifecycleSnapshot,
} from "../../../debug/loggers/stateMachineLogger.js";

function hasValidTurnLifecycleSnapshot(sessionEntry = {}) {
  const snapshot = sessionEntry?.replayBatch?.snapshot;
  return Boolean(snapshot && typeof snapshot === "object" && validateTurnLifecycleSnapshot(snapshot).valid);
}

function resolveAuthoritativeActiveTurn(sessionEntry = {}) {
  const sessionId = _trimStr(sessionEntry?.sessionId);
  const authoritativeRun = sessionEntry?.replayBatch?.snapshot?.activeTurn;
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

function requiresSessionReconciliation(sessionEntry = {}) {
  if (hasValidTurnLifecycleSnapshot(sessionEntry)) return false;
  return Boolean(Array.isArray(sessionEntry?.dialogProcesses) && sessionEntry.dialogProcesses.length);
}

export async function applyReconnectDataReplay({
  reconnectData,
  ensureReconnectSessionActive,
  isCurrentActiveSession,
  replayCache,
  applyReconnectMessagesToActiveSession,
  scheduleCacheExpiredSessionRefresh,
  reconcileSessionState,
  applySubSessionReplayMessages,
  isDeletedTurn,
  hydrateActiveSessionBeforeReplay,
  applyTurnLifecycleEnvelope,
  applyTurnLifecycleSnapshot,
  applyPendingInteraction,
} = {}) {
  const receivedSessions = Array.isArray(reconnectData?.sessions)
    ? reconnectData.sessions
    : [];
  const invalidProtocolSessions = receivedSessions.filter((sessionEntry) => {
    const batch = sessionEntry?.replayBatch;
    return !batch || validateReplayBatch(batch).valid !== true;
  });
  const invalidSessions = receivedSessions.filter((sessionEntry) =>
    invalidProtocolSessions.includes(sessionEntry) || requiresSessionReconciliation(sessionEntry),
  );
  const reconnectSessions = receivedSessions.filter(
    (sessionEntry) => !invalidProtocolSessions.includes(sessionEntry)
      && !requiresSessionReconciliation(sessionEntry),
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
      reason: invalidProtocolSessions.includes(sessionEntry)
        ? "invalid_replay_batch"
        : "missing_authority_snapshot",
    });
  }
  // A reconnect transaction has exactly one Authority baseline. Events are a
  // tail after that baseline, never an alternative snapshot source.
  for (const sessionEntry of reconnectSessions) {
    const snapshot = sessionEntry?.replayBatch?.snapshot;
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
      ? sessionEntry.replayBatch.snapshot
      : null;
    const snapshotSequence = Number(sessionEntry?.replayBatch?.snapshotSequence || 0);
    const lifecycleEvents = Array.isArray(sessionEntry?.replayBatch?.events)
      ? sessionEntry.replayBatch.events
      : [];
    const replayResult = replayEventTail({
      snapshotSequence,
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
    if (!lifecycleEvents.length) {
      for (const interaction of sessionEntry?.replayBatch?.pendingInteractions || []) {
        await applyPendingInteraction?.(interaction);
      }
      continue;
    }
    const sessionId = _trimStr(sessionEntry?.sessionId);
    logStateMachineDebug("stateMachine.reconnect.lifecycleReplay.before", () => ({
      sessionId,
      snapshotSequence,
      eventCount: lifecycleEvents.length,
      firstSequence: Number(lifecycleEvents[0]?.ordering?.streamSequence || lifecycleEvents[0]?.sequence || 0),
      lastSequence: Number(lifecycleEvents.at(-1)?.ordering?.streamSequence || lifecycleEvents.at(-1)?.sequence || 0),
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
    for (const interaction of sessionEntry?.replayBatch?.pendingInteractions || []) {
      await applyPendingInteraction?.(interaction);
    }
  }
  const recoverableSessionId = findRecoverableReconnectSessionId(reconnectSessions);
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
    const dialogProcesses = Array.isArray(sessionEntry?.dialogProcesses)
      ? sessionEntry.dialogProcesses
      : [];
    const hasReplayMessages = dialogProcesses.some((dp) =>
      Array.isArray(dp?.messages) && dp.messages.length > 0,
    );
    const hasAuthoritativeActiveTurn = Boolean(authoritativeActiveTurn && authoritativeActiveTurn.state && !["completed", "stop_completed"].includes(authoritativeActiveTurn.state));
    if ((hasAuthoritativeActiveTurn || hasReplayMessages) && isCurrentActiveSession(sessionId)) {
      // Baseline restoration belongs to the reconnect-data transaction, not to
      // individual event batches. An authoritative in-flight active Turn also
      // requires the baseline when no replay event has been persisted yet.
      logStateMachineDebug("stateMachine.reconnect.hydration.before", () => ({
        sessionId,
        turnScopeId: authoritativeActiveTurnMeta.turnScopeId,
        hasAuthoritativeActiveTurn,
        hasReplayMessages,
      }));
      const hydrated = await hydrateActiveSessionBeforeReplay?.(sessionId, authoritativeActiveTurn);
      logStateMachineDebug("stateMachine.reconnect.hydration.after", () => ({
        sessionId,
        turnScopeId: authoritativeActiveTurnMeta.turnScopeId,
        hydrated: hydrated === true,
      }));
    }
    for (const dp of dialogProcesses) {
      const dpMessages = Array.isArray(dp?.messages) ? dp.messages : [];
      if (!dpMessages.length) continue;
      for (const replayGroup of splitReconnectMessagesByTurnIdentity(
        dpMessages,
        dp?.dialogProcessId || "",
      )) {
        const messages = replayGroup.messages;
        const dpId = resolveDialogProcessIdFromReplay(
          messages,
          replayGroup.dialogProcessId || dp?.dialogProcessId || "",
        );
        if (!messages.length) continue;
        if (!isCurrentActiveSession(sessionId)) {
          const replayTurnScopeId = replayGroup.turnScopeId || normalizeTurnMeta(dp).turnScopeId ||
            authoritativeActiveTurnMeta.turnScopeId;
          const replayKey = normalizeReplayCacheKey(dpId, sessionId, replayTurnScopeId) ||
            `__unknown_${nowMs()}_${Math.random()}`;
          if (!replayCache[sessionId]) replayCache[sessionId] = {};
          replayCache[sessionId][replayKey] = messages;
        } else {
          const replayTurnScopeId = replayGroup.turnScopeId || normalizeTurnMeta(dp).turnScopeId ||
            authoritativeActiveTurnMeta.turnScopeId;
          if (isDeletedTurn?.({ sessionId, turnScopeId: replayTurnScopeId }) === true) continue;
          const isWorkflowNodeReplay = replayTurnScopeId.startsWith("workflow-node:") ||
            messages.some(({ event = "", data = {} } = {}) =>
              event === "subagent_message_event" ||
              data?.route?.scope === "sub_session" ||
              String(data?.event?.turnScopeId || data?.turnScopeId || "").trim().startsWith("workflow-node:"));
          if (isWorkflowNodeReplay) {
            await applySubSessionReplayMessages?.(messages, {
              rootSessionId: sessionId,
              dialogProcessId: dpId,
              turnScopeId: replayTurnScopeId,
            });
            continue;
          }
          await applyReconnectMessagesToActiveSession(messages, dpId, {
            turnScopeId: replayTurnScopeId,
          });
        }
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
    cacheExpired: reconnectData?.cacheExpired === true,
  }));

  if (reconnectData?.cacheExpired) {
    scheduleCacheExpiredSessionRefresh();
  }
}
