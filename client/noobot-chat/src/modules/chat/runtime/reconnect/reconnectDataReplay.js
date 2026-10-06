/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { findRecoverableReconnectSessionId } from "../../model/reconnectReplayModel.js";
import { _trimStr } from "./utils.js";
import { normalizeTurnMeta } from "../../model/messageIdentity.js";
import {
  isPendingInteractionReplay,
  readProtocolEventReducerInput,
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
  return Boolean(
    snapshot && typeof snapshot === "object" && validateTurnLifecycleSnapshot(snapshot).valid,
  );
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

const UNSUPPORTED_RECONNECT_CACHE_KEYS = Object.freeze([
  "cacheExpired",
  "expiredDialogProcessIds",
  "suggestion",
]);

function assertSupportedReconnectData(reconnectData) {
  const source = reconnectData || {};
  if (UNSUPPORTED_RECONNECT_CACHE_KEYS.some((key) => key in source)) {
    throw new Error("unsupported_reconnect_cache_branch");
  }
}

function isInvalidReplaySession(sessionEntry) {
  const batch = sessionEntry?.replayBatch;
  return (
    "dialogProcesses" in (sessionEntry || {}) || !batch || validateReplayBatch(batch).valid !== true
  );
}

function partitionReconnectSessions(reconnectData) {
  const receivedSessions = Array.isArray(reconnectData?.sessions) ? reconnectData.sessions : [];
  const invalidSessions = receivedSessions.filter(isInvalidReplaySession);
  const reconnectSessions = receivedSessions.filter(
    (sessionEntry) => !invalidSessions.includes(sessionEntry),
  );
  return { receivedSessions, invalidSessions, reconnectSessions };
}

function readReplayEvents(sessionEntry) {
  const events = sessionEntry?.replayBatch?.events;
  return Array.isArray(events) ? events : [];
}

function logReconnectPlan({ receivedSessions, invalidSessions, reconnectSessions }) {
  logStateMachineDebug("stateMachine.reconnect.data.planned", () => ({
    receivedSessionCount: receivedSessions.length,
    validSessionCount: reconnectSessions.length,
    invalidSessionCount: invalidSessions.length,
    lifecycleEventCount: reconnectSessions.reduce(
      (count, sessionEntry) => count + readReplayEvents(sessionEntry).length,
      0,
    ),
    lifecycleSnapshotCount: reconnectSessions.filter(hasValidTurnLifecycleSnapshot).length,
  }));
}

async function reconcileInvalidSessions(invalidSessions, reconcileSessionState) {
  for (const sessionEntry of invalidSessions) {
    await reconcileSessionState?.({
      sessionId: _trimStr(sessionEntry?.sessionId),
      reason: "invalid_replay_batch",
    });
  }
}

function applyReplaySnapshots(reconnectSessions, applyTurnLifecycleSnapshot) {
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
}

function summarizeLifecycleReplayResults(results) {
  return {
    appliedCount: results.filter((result) => result?.applied === true).length,
    rejectedCount: results.filter((result) => result?.applied === false).length,
    reasons: [...new Set(results.map((result) => String(result?.reason || "")).filter(Boolean))],
  };
}

async function applyLifecycleEvents(lifecycleEvents, applyTurnLifecycleEnvelope) {
  const results = [];
  for (const envelope of lifecycleEvents) {
    const result = await applyTurnLifecycleEnvelope?.(envelope);
    results.push(Array.isArray(result) ? result[0] : result);
  }
  return results;
}

async function replaySessionEventTail(sessionEntry, callbacks) {
  const { reconcileSessionState, applyTurnLifecycleEnvelope } = callbacks;
  const snapshotSequence = Number(sessionEntry?.replayBatch?.snapshotSequence || 0);
  const lifecycleEvents = readReplayEvents(sessionEntry);
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
    return;
  }
  if (!lifecycleEvents.length) return;
  const sessionId = _trimStr(sessionEntry?.sessionId);
  logStateMachineDebug("stateMachine.reconnect.lifecycleReplay.before", () => ({
    sessionId,
    snapshotSequence,
    eventCount: lifecycleEvents.length,
    firstSequence: Number(lifecycleEvents[0]?.ordering?.sequence || 0),
    lastSequence: Number(lifecycleEvents.at(-1)?.ordering?.sequence || 0),
  }));
  const results = await applyLifecycleEvents(lifecycleEvents, applyTurnLifecycleEnvelope);
  logStateMachineDebug("stateMachine.reconnect.lifecycleReplay.after", () => ({
    sessionId,
    snapshotSequence,
    eventCount: lifecycleEvents.length,
    ...summarizeLifecycleReplayResults(results),
  }));
}

async function activateRecoverableSession(recoverableSessionId, callbacks) {
  const { ensureReconnectSessionActive, isCurrentActiveSession } = callbacks;
  if (!recoverableSessionId) return;
  logStateMachineDebug("stateMachine.reconnect.activation.before", () => ({
    sessionId: recoverableSessionId,
  }));
  await ensureReconnectSessionActive(recoverableSessionId);
  logStateMachineDebug("stateMachine.reconnect.activation.after", () => ({
    sessionId: recoverableSessionId,
    active: isCurrentActiveSession(recoverableSessionId),
  }));
}

function isActiveAuthoritativeTurn(authoritativeActiveTurn) {
  return Boolean(
    authoritativeActiveTurn &&
    authoritativeActiveTurn.state &&
    !["completed", "stop_completed"].includes(authoritativeActiveTurn.state),
  );
}

async function hydrateActiveSession(sessionEntry, callbacks) {
  const { isCurrentActiveSession, hydrateActiveSessionBeforeReplay } = callbacks;
  const sessionId = _trimStr(sessionEntry?.sessionId);
  if (!sessionId) return;
  const authoritativeActiveTurn = resolveAuthoritativeActiveTurn(sessionEntry);
  const authoritativeActiveTurnMeta = normalizeTurnMeta(authoritativeActiveTurn || {});
  const hasAuthoritativeActiveTurn = isActiveAuthoritativeTurn(authoritativeActiveTurn);
  if (!hasAuthoritativeActiveTurn || !isCurrentActiveSession(sessionId)) return;
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

async function replayPendingInteractions(sessionEntry, applyPendingInteraction) {
  const channelSessionId = _trimStr(sessionEntry?.sessionId);
  for (const interaction of sessionEntry?.replayBatch?.pendingInteractions || []) {
    if (!isPendingInteractionReplay(interaction)) continue;
    const reducerInput = readProtocolEventReducerInput(interaction);
    if (reducerInput.valid) {
      await applyPendingInteraction?.(reducerInput.input, { channelSessionId });
    }
  }
}

function logReconnectComplete(partition, recoverableSessionId) {
  const { receivedSessions, invalidSessions, reconnectSessions } = partition;
  const recoverableSessionEntry = reconnectSessions.find(
    (sessionEntry) => _trimStr(sessionEntry?.sessionId) === recoverableSessionId,
  );
  logStateMachineDebug("stateMachine.reconnect.transaction.complete", () => ({
    sessionId: recoverableSessionId,
    receivedSessionCount: receivedSessions.length,
    validSessionCount: reconnectSessions.length,
    invalidSessionCount: invalidSessions.length,
    recoverableSessionId,
    recoverableTurnScopeId: normalizeTurnMeta(
      resolveAuthoritativeActiveTurn(recoverableSessionEntry) || {},
    ).turnScopeId,
    authoritativeSnapshotReceivedCount: reconnectSessions.filter(hasValidTurnLifecycleSnapshot)
      .length,
  }));
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
  assertSupportedReconnectData(reconnectData);
  const partition = partitionReconnectSessions(reconnectData);
  const { invalidSessions, reconnectSessions } = partition;
  logReconnectPlan(partition);
  await reconcileInvalidSessions(invalidSessions, reconcileSessionState);
  applyReplaySnapshots(reconnectSessions, applyTurnLifecycleSnapshot);
  for (const sessionEntry of reconnectSessions) {
    await replaySessionEventTail(sessionEntry, {
      reconcileSessionState,
      applyTurnLifecycleEnvelope,
    });
  }
  const recoverableSessionId = findRecoverableReconnectSessionId(
    reconnectSessions,
    reconnectData?.currentSessionId,
  );
  await activateRecoverableSession(recoverableSessionId, {
    ensureReconnectSessionActive,
    isCurrentActiveSession,
  });
  for (const sessionEntry of reconnectSessions) {
    await hydrateActiveSession(sessionEntry, {
      isCurrentActiveSession,
      hydrateActiveSessionBeforeReplay,
    });
  }
  for (const sessionEntry of reconnectSessions) {
    await replayPendingInteractions(sessionEntry, applyPendingInteraction);
  }
  logReconnectComplete(partition, recoverableSessionId);
}
