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
import { isInFlightConversationState } from "./conversationState.js";
import { _trimStr } from "./utils.js";
import {
  BackendChannelState,
  SESSION_RUN_EVENT,
  resolveRememberedStopRequestedEvent,
} from "../sessionRunStateMachine.js";
import { normalizeTurnMeta } from "../../model/messageIdentity.js";
import { normalizeReplayCacheKey } from "./replayCache.js";
import { validateTurnLifecycleSnapshot } from "@noobot/authoritative-state/contracts";
import {
  logStateMachineDebug,
  summarizeTurnLifecycleSnapshot,
} from "../../../debug/loggers/stateMachineLogger.js";

function hasValidTurnLifecycleSnapshot(sessionEntry = {}) {
  const snapshot = sessionEntry?.turnLifecycleSnapshot;
  return Boolean(snapshot && typeof snapshot === "object" && validateTurnLifecycleSnapshot(snapshot).valid);
}

function resolveAuthoritativeConversationStates(sessionEntry = {}) {
  const sessionId = _trimStr(sessionEntry?.sessionId);
  const authoritativeRun = sessionEntry?.currentRun;
  const authoritativeRunMeta = normalizeTurnMeta(authoritativeRun);
  const hasConsistentAuthoritativeRun =
    _trimStr(authoritativeRunMeta.sessionId) === sessionId &&
    Boolean(_trimStr(authoritativeRunMeta.turnScopeId));
  if (hasConsistentAuthoritativeRun) {
    return [{
      ...authoritativeRun,
      authoritativeSnapshot: true,
      sessionId: authoritativeRunMeta.sessionId,
      dialogProcessId: authoritativeRunMeta.dialogProcessId,
      turnScopeId: authoritativeRunMeta.turnScopeId,
    }];
  }
  return [];
}

function hasValidCurrentRun(sessionEntry = {}) {
  return resolveAuthoritativeConversationStates(sessionEntry).length === 1;
}

function requiresSessionReconciliation(sessionEntry = {}) {
  if (hasValidCurrentRun(sessionEntry) || hasValidTurnLifecycleSnapshot(sessionEntry)) return false;
  return Boolean(
    sessionEntry?.hasRunningTask === true ||
    (Array.isArray(sessionEntry?.conversationStates) && sessionEntry.conversationStates.length) ||
    (Array.isArray(sessionEntry?.dialogProcesses) && sessionEntry.dialogProcesses.length),
  );
}

function createReconnectRunStateEvents(reconnectSessions = [], recoverableSessionId = "") {
  const events = [];
  if (recoverableSessionId) {
    const recoverableSessionEntry = reconnectSessions.find(
      (sessionEntry) => _trimStr(sessionEntry?.sessionId) === recoverableSessionId,
    );
    const recoverableRunMeta = normalizeTurnMeta(recoverableSessionEntry?.currentRun || {});
    const rememberedStopEvent = resolveRememberedStopRequestedEvent({
      sessionId: recoverableSessionId,
      dialogProcessId: recoverableRunMeta.dialogProcessId,
      turnScopeId: recoverableRunMeta.turnScopeId,
    });
    if (rememberedStopEvent) events.push(rememberedStopEvent);
  }
  reconnectSessions.forEach((sessionEntry) => {
    const sessionId = _trimStr(sessionEntry?.sessionId);
    const stateEntries = resolveAuthoritativeConversationStates(sessionEntry);
    stateEntries.forEach((stateEntry) => {
      const turnMeta = normalizeTurnMeta(stateEntry);
      const rememberedStopEvent = resolveRememberedStopRequestedEvent({
        sessionId,
        dialogProcessId: _trimStr(stateEntry?.dialogProcessId),
        turnScopeId: turnMeta.turnScopeId,
      });
      if (rememberedStopEvent) events.push(rememberedStopEvent);
      const state = _trimStr(stateEntry?.state);
      events.push({
        type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
        state,
        sessionId,
        dialogProcessId: _trimStr(stateEntry?.dialogProcessId),
        turnScopeId: turnMeta.turnScopeId,
        source: "reconnect_data",
        sourceEvent: _trimStr(stateEntry?.sourceEvent),
        seq: Number(stateEntry?.seq || 0),
        authoritativeSnapshot: stateEntry?.authoritativeSnapshot === true,
      });
    });
  });
  return events;
}

export async function applyReconnectDataReplay({
  reconnectData,
  ensureReconnectSessionActive,
  applyRunStateEvents,
  isCurrentActiveSession,
  replayCache,
  applyReconnectMessagesToActiveSession,
  applyChannelState,
  scheduleCacheExpiredSessionRefresh,
  reconcileSessionState,
  applySubSessionReplayMessages,
  isDeletedTurn,
  hydrateActiveSessionBeforeReplay,
  applyTurnLifecycleEnvelope,
  applyTurnLifecycleSnapshot,
} = {}) {
  const receivedSessions = Array.isArray(reconnectData?.sessions)
    ? reconnectData.sessions
    : [];
  const invalidSessions = receivedSessions.filter(requiresSessionReconciliation);
  const reconnectSessions = receivedSessions.filter(
    (sessionEntry) => !requiresSessionReconciliation(sessionEntry),
  );
  logStateMachineDebug("stateMachine.reconnect.data.planned", () => ({
    receivedSessionCount: receivedSessions.length,
    validSessionCount: reconnectSessions.length,
    invalidSessionCount: invalidSessions.length,
    lifecycleEventCount: reconnectSessions.reduce(
      (count, sessionEntry) => count + (Array.isArray(sessionEntry?.lifecycleEvents)
        ? sessionEntry.lifecycleEvents.length
        : 0),
      0,
    ),
    lifecycleSnapshotCount: reconnectSessions.filter(hasValidTurnLifecycleSnapshot).length,
  }));
  for (const sessionEntry of invalidSessions) {
    await reconcileSessionState?.({
      sessionId: _trimStr(sessionEntry?.sessionId),
      hasRunningTask: sessionEntry?.hasRunningTask === true,
      reason: "invalid_current_run",
    });
  }
  for (const sessionEntry of reconnectSessions) {
    const lifecycleEvents = (Array.isArray(sessionEntry?.lifecycleEvents)
      ? sessionEntry.lifecycleEvents
      : [])
      .map((item) => item?.data && typeof item.data === "object" ? item.data : item)
      .filter((item) => item && typeof item === "object")
      .sort((left, right) => Number(left?.sequence || 0) - Number(right?.sequence || 0));
    if (!lifecycleEvents.length) continue;
    const sessionId = _trimStr(sessionEntry?.sessionId);
    logStateMachineDebug("stateMachine.reconnect.lifecycleReplay.before", () => ({
      sessionId,
      eventCount: lifecycleEvents.length,
      firstSequence: Number(lifecycleEvents[0]?.sequence || 0),
      lastSequence: Number(lifecycleEvents.at(-1)?.sequence || 0),
    }));
    const results = [];
    for (const envelope of lifecycleEvents) {
      const result = await applyTurnLifecycleEnvelope?.(envelope);
      results.push(Array.isArray(result) ? result[0] : result);
    }
    logStateMachineDebug("stateMachine.reconnect.lifecycleReplay.after", () => ({
      sessionId,
      eventCount: lifecycleEvents.length,
      appliedCount: results.filter((result) => result?.applied === true).length,
      rejectedCount: results.filter((result) => result?.applied === false).length,
      reasons: [...new Set(results.map((result) => String(result?.reason || "")).filter(Boolean))],
    }));
  }
  for (const sessionEntry of reconnectSessions) {
    const snapshot = sessionEntry?.turnLifecycleSnapshot;
    if (!snapshot || typeof snapshot !== "object") continue;
    logStateMachineDebug("stateMachine.reconnect.snapshot.received", () => ({
      ...summarizeTurnLifecycleSnapshot(snapshot),
      currentRunState: _trimStr(sessionEntry?.currentRun?.state),
      currentRunSequence: Number(sessionEntry?.currentRun?.seq || sessionEntry?.currentRun?.sequence || 0),
      hasRunningTask: sessionEntry?.hasRunningTask === true,
    }));
    const result = applyTurnLifecycleSnapshot?.(snapshot);
    logStateMachineDebug("stateMachine.reconnect.snapshot.applied", () => ({
      ...summarizeTurnLifecycleSnapshot(snapshot),
      applied: result?.applied === true,
      reason: result?.reason || "",
      errorCount: Array.isArray(result?.errors) ? result.errors.length : 0,
    }));
  }
  const recoverableSessionId = findRecoverableReconnectSessionId(reconnectSessions);
  const recoverableSessionEntry = reconnectSessions.find(
    (sessionEntry) => _trimStr(sessionEntry?.sessionId) === recoverableSessionId,
  );
  const applyReconnectRunState = () => applyRunStateEvents?.(
    createReconnectRunStateEvents(reconnectSessions, recoverableSessionId),
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
    applyReconnectRunState();
  }

  for (const sessionEntry of reconnectSessions) {
    const sessionId = _trimStr(sessionEntry?.sessionId);
    if (!sessionId) continue;
    const currentRunMeta = normalizeTurnMeta(sessionEntry?.currentRun || {});
    const dialogProcesses = Array.isArray(sessionEntry?.dialogProcesses)
      ? sessionEntry.dialogProcesses
      : [];
    const hasReplayMessages = dialogProcesses.some((dp) =>
      Array.isArray(dp?.messages) && dp.messages.length > 0,
    );
    const hasActiveCurrentRun =
      hasValidCurrentRun(sessionEntry) &&
      isInFlightConversationState(sessionEntry?.currentRun?.state);
    if ((hasActiveCurrentRun || hasReplayMessages) && isCurrentActiveSession(sessionId)) {
      // Baseline restoration belongs to the reconnect-data transaction, not to
      // individual event batches. An authoritative in-flight currentRun also
      // requires the baseline when no replay event has been persisted yet.
      logStateMachineDebug("stateMachine.reconnect.hydration.before", () => ({
        sessionId,
        turnScopeId: currentRunMeta.turnScopeId,
        hasActiveCurrentRun,
        hasReplayMessages,
      }));
      const hydrated = await hydrateActiveSessionBeforeReplay?.(sessionId, sessionEntry?.currentRun || null);
      logStateMachineDebug("stateMachine.reconnect.hydration.after", () => ({
        sessionId,
        turnScopeId: currentRunMeta.turnScopeId,
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
            currentRunMeta.turnScopeId;
          const replayKey = normalizeReplayCacheKey(dpId, sessionId, replayTurnScopeId) ||
            `__unknown_${nowMs()}_${Math.random()}`;
          if (!replayCache[sessionId]) replayCache[sessionId] = {};
          replayCache[sessionId][replayKey] = messages;
        } else {
          const replayTurnScopeId = replayGroup.turnScopeId || normalizeTurnMeta(dp).turnScopeId ||
            currentRunMeta.turnScopeId;
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

  for (const sessionEntry of reconnectSessions) {
    const stateEntries = resolveAuthoritativeConversationStates(sessionEntry);
    for (const stateEntry of stateEntries) {
      await applyChannelState(stateEntry);
    }
  }

  if (recoverableSessionId && isCurrentActiveSession(recoverableSessionId)) {
    applyReconnectRunState();
  }

  logStateMachineDebug("stateMachine.reconnect.transaction.complete", () => ({
    sessionId: recoverableSessionId,
    receivedSessionCount: receivedSessions.length,
    validSessionCount: reconnectSessions.length,
    invalidSessionCount: invalidSessions.length,
    recoverableSessionId,
    recoverableCurrentRunState: _trimStr(recoverableSessionEntry?.currentRun?.state),
    recoverableTurnScopeId: normalizeTurnMeta(recoverableSessionEntry?.currentRun || {}).turnScopeId,
    authoritativeSnapshotRequestedCount: reconnectSessions.filter(
      (sessionEntry) => sessionEntry?.lifecycleSnapshotRequested === true,
    ).length,
    authoritativeSnapshotReceivedCount: reconnectSessions.filter(hasValidTurnLifecycleSnapshot).length,
    cacheExpired: reconnectData?.cacheExpired === true,
  }));

  if (reconnectData?.cacheExpired) {
    scheduleCacheExpiredSessionRefresh();
  }
}
