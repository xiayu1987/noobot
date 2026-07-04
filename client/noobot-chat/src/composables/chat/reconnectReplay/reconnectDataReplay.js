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

function createReconnectRunStateEvents(reconnectSessions = [], recoverableSessionId = "") {
  const events = [];
  if (recoverableSessionId) {
    const rememberedStopEvent = resolveRememberedStopRequestedEvent({
      sessionId: recoverableSessionId,
    });
    if (rememberedStopEvent) events.push(rememberedStopEvent);
    events.push({
      type: SESSION_RUN_EVENT.BACKEND_RECOVERABLE_RUNNING,
      state: BackendChannelState.RECONNECTING,
      sessionId: recoverableSessionId,
      source: "reconnect_data",
    });
  }
  reconnectSessions.forEach((sessionEntry) => {
    const sessionId = _trimStr(sessionEntry?.sessionId);
    const stateEntries = Array.isArray(sessionEntry?.conversationStates)
      ? sessionEntry.conversationStates
      : [];
    stateEntries.forEach((stateEntry) => {
      const turnMeta = normalizeTurnMeta(stateEntry);
      const rememberedStopEvent = resolveRememberedStopRequestedEvent({
        sessionId,
        dialogProcessId: _trimStr(stateEntry?.dialogProcessId),
        turnScopeId: turnMeta.turnScopeId,
      });
      if (rememberedStopEvent) events.push(rememberedStopEvent);
      events.push({
        type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
        state: _trimStr(stateEntry?.state),
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

function resolveReconnectSessionRunningStateFromStates(sessionEntry = null) {
  const stateEntries = Array.isArray(sessionEntry?.conversationStates)
    ? sessionEntry.conversationStates
    : [];
  if (!stateEntries.length) return null;
  let restoredState = null;
  for (const stateEntry of stateEntries) {
    const state = _trimStr(stateEntry?.state);
    if (isInFlightConversationState(state)) {
      restoredState = {
        sending: true,
        canStop: state === BackendChannelState.SENDING || state === BackendChannelState.RECONNECTING,
      };
    }
    if (isTerminalConversationState(state)) {
      restoredState = { sending: false, canStop: false };
    }
  }
  return restoredState;
}

export async function applyReconnectDataReplay({
  reconnectData,
  ensureReconnectSessionActive,
  sending,
  canStop,
  applyRunStateEvents,
  isCurrentActiveSession,
  resolveReconnectTargetAssistantMessage,
  replayCache,
  applyReconnectMessagesToActiveSession,
  applyChannelState,
  scheduleCacheExpiredSessionRefresh,
} = {}) {
  const reconnectSessions = Array.isArray(reconnectData?.sessions)
    ? reconnectData.sessions
    : [];
  const recoverableSessionId = findRecoverableReconnectSessionId(reconnectSessions);
  const applyReconnectRunState = () => applyRunStateEvents?.(
    createReconnectRunStateEvents(reconnectSessions, recoverableSessionId),
  );
  if (recoverableSessionId) {
    await ensureReconnectSessionActive(recoverableSessionId);
    if (applyRunStateEvents) {
      applyReconnectRunState();
    } else {
      // Compatibility fallback for callers that do not provide the run state machine bridge.
      sending.value = true;
      if (canStop) canStop.value = true;
    }
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
      resolveReconnectTargetAssistantMessage("", { allowCreate: true });
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
          });
        }
      }
    }
  }

  reconnectSessions.forEach((sessionEntry) => {
    const stateEntries = Array.isArray(sessionEntry?.conversationStates)
      ? sessionEntry.conversationStates
      : [];
    stateEntries.forEach((stateEntry) => {
      applyChannelState(stateEntry);
    });
  });

  if (recoverableSessionId && isCurrentActiveSession(recoverableSessionId)) {
    const recoverableSessionEntry = reconnectSessions.find(
      (sessionEntry) => _trimStr(sessionEntry?.sessionId) === recoverableSessionId,
    );
    const restoredState = resolveReconnectSessionRunningStateFromStates(recoverableSessionEntry);
    if (applyRunStateEvents) {
      applyReconnectRunState();
    } else if (restoredState !== null) {
      // Compatibility fallback for callers that do not provide the run state machine bridge.
      sending.value = restoredState.sending;
      if (canStop) canStop.value = restoredState.canStop;
    }
  }

  if (reconnectData?.cacheExpired) {
    scheduleCacheExpiredSessionRefresh();
  }
}
