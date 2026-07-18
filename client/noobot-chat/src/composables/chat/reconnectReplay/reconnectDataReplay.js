/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  findRecoverableReconnectSessionId,
  isDialogProcessRecoverable,
  resolveDialogProcessIdFromReplay,
  splitReconnectMessagesByDialogProcessId,
} from "../../infra/reconnectReplayModel";
import { nowMs } from "../../infra/timeFields";
import {
  isInFlightConversationState,
  isTerminalConversationState,
} from "./conversationState";
import { _trimStr } from "./utils";
import {
  BackendChannelState,
  SESSION_RUN_EVENT,
  resolveRememberedStopRequestedEvent,
} from "../sessionRunStateMachine";
import { normalizeTurnMeta } from "../../infra/messageIdentity";

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
  if (hasValidCurrentRun(sessionEntry)) return false;
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
  resolveReconnectTargetAssistantMessage,
  replayCache,
  applyReconnectMessagesToActiveSession,
  applyChannelState,
  scheduleCacheExpiredSessionRefresh,
  reconcileSessionState,
} = {}) {
  const receivedSessions = Array.isArray(reconnectData?.sessions)
    ? reconnectData.sessions
    : [];
  const invalidSessions = receivedSessions.filter(requiresSessionReconciliation);
  const reconnectSessions = receivedSessions.filter(
    (sessionEntry) => !requiresSessionReconciliation(sessionEntry),
  );
  for (const sessionEntry of invalidSessions) {
    await reconcileSessionState?.({
      sessionId: _trimStr(sessionEntry?.sessionId),
      hasRunningTask: sessionEntry?.hasRunningTask === true,
      reason: "invalid_current_run",
    });
  }
  const recoverableSessionId = findRecoverableReconnectSessionId(reconnectSessions);
  const applyReconnectRunState = () => applyRunStateEvents?.(
    createReconnectRunStateEvents(reconnectSessions, recoverableSessionId),
  );
  if (recoverableSessionId) {
    await ensureReconnectSessionActive(recoverableSessionId);
    applyReconnectRunState();
    const recoverableSessionEntry = reconnectSessions.find(
      (sessionEntry) => _trimStr(sessionEntry?.sessionId) === recoverableSessionId,
    );
    const recoverableDialogProcesses = Array.isArray(
      recoverableSessionEntry?.dialogProcesses,
    )
      ? recoverableSessionEntry.dialogProcesses
      : [];
    const hasReconnectMessages = recoverableDialogProcesses.some(
      (dialogProcess) => Array.isArray(dialogProcess?.messages) && dialogProcess.messages.length,
    );
    if (!hasReconnectMessages && isCurrentActiveSession(recoverableSessionId)) {
      const currentRunMeta = normalizeTurnMeta(recoverableSessionEntry?.currentRun || {});
      // Diagnostic data is emitted by the caller-facing replay bridge when available.
      // Keep the raw identity visible to that bridge, including an empty value.
      resolveReconnectTargetAssistantMessage(currentRunMeta.dialogProcessId, {
        allowCreate: true,
        turnScopeId: currentRunMeta.turnScopeId,
      });
    }
  }

  for (const sessionEntry of reconnectSessions) {
    const sessionId = _trimStr(sessionEntry?.sessionId);
    if (!sessionId) continue;
    const dialogProcesses = Array.isArray(sessionEntry?.dialogProcesses)
      ? sessionEntry.dialogProcesses
      : [];
    for (const dp of dialogProcesses) {
      const dpMessages = Array.isArray(dp?.messages) ? dp.messages : [];
      if (!dpMessages.length) continue;
      for (const replayGroup of splitReconnectMessagesByDialogProcessId(
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
          const replayKey = dpId || `__unknown_${nowMs()}_${Math.random()}`;
          if (!replayCache[sessionId]) replayCache[sessionId] = {};
          replayCache[sessionId][replayKey] = messages;
        } else {
          await applyReconnectMessagesToActiveSession(messages, dpId, {
            allowCreate: isDialogProcessRecoverable(sessionEntry, messages),
            turnScopeId: normalizeTurnMeta(dp).turnScopeId ||
              normalizeTurnMeta(sessionEntry?.currentRun || {}).turnScopeId,
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
    const recoverableSessionEntry = reconnectSessions.find(
      (sessionEntry) => _trimStr(sessionEntry?.sessionId) === recoverableSessionId,
    );
    applyReconnectRunState();
  }

  if (reconnectData?.cacheExpired) {
    scheduleCacheExpiredSessionRefresh();
  }
}
