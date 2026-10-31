/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { findReconnectTargetSessionId } from "../../model/reconnectReplayModel.js";
import { projectProtocolEventReducerInput, validateReplayBatch } from "@noobot/event-protocol";
import { isTerminalTurnState } from "@noobot/session-protocol";
import {
  logStateMachineDebug,
  summarizeTurnLifecycleSnapshot,
} from "../../../debug/loggers/stateMachineLogger.js";

function hasTurnSnapshot(sessionEntry) {
  return sessionEntry.replayBatch.snapshot !== null;
}

function readSnapshotActiveTurn(sessionEntry) {
  if (!hasTurnSnapshot(sessionEntry)) return null;
  return sessionEntry.replayBatch.snapshot.payload.activeTurn;
}

function readRunningActiveTurn(sessionEntry) {
  const activeTurn = readSnapshotActiveTurn(sessionEntry);
  if (activeTurn === null || isTerminalTurnState(activeTurn.state)) return null;
  return activeTurn;
}

function isInvalidReplaySession(sessionEntry) {
  return validateReplayBatch(sessionEntry.replayBatch).valid !== true;
}

function partitionReconnectSessions(reconnectData) {
  const receivedSessions = reconnectData.sessions;
  const invalidSessions = receivedSessions.filter(isInvalidReplaySession);
  const reconnectSessions = receivedSessions.filter(
    (sessionEntry) => !invalidSessions.includes(sessionEntry),
  );
  return { receivedSessions, invalidSessions, reconnectSessions };
}

function logReconnectPlan({ receivedSessions, invalidSessions, reconnectSessions }) {
  logStateMachineDebug("stateMachine.reconnect.data.planned", () => ({
    receivedSessionCount: receivedSessions.length,
    validSessionCount: reconnectSessions.length,
    invalidSessionCount: invalidSessions.length,
    lifecycleEventCount: reconnectSessions.reduce(
      (count, sessionEntry) => count + sessionEntry.replayBatch.events.length,
      0,
    ),
    lifecycleSnapshotCount: reconnectSessions.filter(hasTurnSnapshot).length,
  }));
}

async function reconcileInvalidSessions(invalidSessions, reconcileSessionState) {
  for (const sessionEntry of invalidSessions) {
    await reconcileSessionState({
      sessionId: sessionEntry.sessionId,
      reason: "invalid_replay_batch",
    });
  }
}

function applyReplaySnapshots(reconnectSessions, applyTurnLifecycleSnapshot) {
  for (const sessionEntry of reconnectSessions) {
    if (!hasTurnSnapshot(sessionEntry)) continue;
    const snapshot = sessionEntry.replayBatch.snapshot.payload;
    logStateMachineDebug("stateMachine.reconnect.snapshot.received", () => ({
      ...summarizeTurnLifecycleSnapshot(snapshot),
    }));
    const result = applyTurnLifecycleSnapshot(snapshot);
    logStateMachineDebug("stateMachine.reconnect.snapshot.applied", () => ({
      ...summarizeTurnLifecycleSnapshot(snapshot),
      applied: result.applied,
      reason: result.reason,
    }));
  }
}

function summarizeLifecycleReplayResults(results) {
  const rejected = results.filter((result) => result.applied !== true);
  return {
    appliedCount: results.length - rejected.length,
    rejectedCount: rejected.length,
    reasons: [...new Set(rejected.map((result) => result.reason))],
  };
}

async function applyLifecycleEvents(lifecycleEvents, applyTurnLifecycleEnvelope) {
  const results = [];
  for (const envelope of lifecycleEvents) {
    results.push(await applyTurnLifecycleEnvelope(projectProtocolEventReducerInput(envelope)));
  }
  return results;
}

async function replaySessionEventTail(sessionEntry, applyTurnLifecycleEnvelope) {
  const { sessionId, snapshotSequence, events: lifecycleEvents } = sessionEntry.replayBatch;
  if (!lifecycleEvents.length) return;
  logStateMachineDebug("stateMachine.reconnect.lifecycleReplay.before", () => ({
    sessionId,
    snapshotSequence,
    eventCount: lifecycleEvents.length,
    firstSequence: lifecycleEvents[0].ordering.sequence,
    lastSequence: lifecycleEvents.at(-1).ordering.sequence,
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

async function hydrateActiveSession(sessionEntry, callbacks) {
  const { isCurrentActiveSession, hydrateActiveSessionBeforeReplay } = callbacks;
  const { sessionId } = sessionEntry.replayBatch;
  const activeTurn = readRunningActiveTurn(sessionEntry);
  if (activeTurn === null || !isCurrentActiveSession(sessionId)) return;
  logStateMachineDebug("stateMachine.reconnect.hydration.before", () => ({
    sessionId,
    turnScopeId: activeTurn.turnScopeId,
  }));
  const hydrated = await hydrateActiveSessionBeforeReplay(sessionId, activeTurn);
  logStateMachineDebug("stateMachine.reconnect.hydration.after", () => ({
    sessionId,
    turnScopeId: activeTurn.turnScopeId,
    hydrated: hydrated === true,
  }));
}

async function replayPendingInteractions(sessionEntry, applyPendingInteraction) {
  const channelSessionId = sessionEntry.replayBatch.sessionId;
  for (const interaction of sessionEntry.replayBatch.pendingInteractions) {
    await applyPendingInteraction(projectProtocolEventReducerInput(interaction), {
      channelSessionId,
    });
  }
}

function logReconnectComplete(partition, recoverableSessionId) {
  const { receivedSessions, invalidSessions, reconnectSessions } = partition;
  const recoverableSessionEntry = reconnectSessions.find(
    (sessionEntry) => sessionEntry.replayBatch.sessionId === recoverableSessionId,
  );
  const recoverableTurn = recoverableSessionEntry
    ? readSnapshotActiveTurn(recoverableSessionEntry)
    : null;
  logStateMachineDebug("stateMachine.reconnect.transaction.complete", () => ({
    sessionId: recoverableSessionId,
    receivedSessionCount: receivedSessions.length,
    validSessionCount: reconnectSessions.length,
    invalidSessionCount: invalidSessions.length,
    recoverableSessionId,
    recoverableTurnScopeId: recoverableTurn === null ? null : recoverableTurn.turnScopeId,
    authoritativeSnapshotReceivedCount: reconnectSessions.filter(hasTurnSnapshot).length,
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
}) {
  const partition = partitionReconnectSessions(reconnectData);
  const { invalidSessions, reconnectSessions } = partition;
  logReconnectPlan(partition);
  await reconcileInvalidSessions(invalidSessions, reconcileSessionState);
  applyReplaySnapshots(reconnectSessions, applyTurnLifecycleSnapshot);
  for (const sessionEntry of reconnectSessions) {
    await replaySessionEventTail(sessionEntry, applyTurnLifecycleEnvelope);
  }
  const recoverableSessionId = findReconnectTargetSessionId(
    reconnectSessions,
    reconnectData.identity.sessionId,
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
