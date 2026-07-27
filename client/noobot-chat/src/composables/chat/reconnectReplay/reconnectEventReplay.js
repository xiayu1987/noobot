/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StreamEventEnum } from "../../../shared/constants/chatConstants";
import { BackendChannelState } from "../sessionRunStateMachine";
import { normalizeReplayCacheKey } from "./replayCache";
import { _trimStr } from "./utils";
import { normalizeTurnTransportEnvelope } from "../chatEngine/turnTransportEnvelope";

const WORKFLOW_RUNTIME_EVENT_NAMES = new Set([
  "workflow_planning_message_prepared",
  "workflow_node_state_committed",
]);

export async function applyReconnectEventReplay({
  event: incomingEvent,
  data: incomingData,
  replayCache,
  isCurrentActiveSession,
  isCurrentActiveDialogProcess,
  consumeReplayCacheForSession,
  applyReconnectMessagesToActiveSession,
  applyChannelState,
  hasAuthoritativeCurrentRun,
  applyTurnLifecycleEnvelope,
  applyTurnLifecycleSnapshot,
  applyExecutionSnapshot,
  applyExecutionChildren,
  applyExecutionTree,
  applyWorkflowRuntimeEvent,
  applySubSessionReplayMessages,
  finalizeDoneTurnPresentation,
  isDeletedTurn,
} = {}) {
  const normalizedTransportEnvelope = normalizeTurnTransportEnvelope({
    event: incomingEvent,
    data: incomingData,
    source: "reconnect",
  });
  const replayEvent = normalizedTransportEnvelope.event;
  const data = normalizedTransportEnvelope.data;
  const replaySessionId = _trimStr(data?.sessionId || data?.messageEvent?.sessionId);
  const replayTurnScopeId = _trimStr(data?.turnScopeId || data?.messageEvent?.turnScopeId);
  if (isDeletedTurn?.({ sessionId: replaySessionId, turnScopeId: replayTurnScopeId }) === true) {
    return { applied: false, reason: "deleted_turn_tombstoned" };
  }
  if (replayEvent === "subagent_message_event" || data?.route?.scope === "sub_session") {
    return applySubSessionReplayMessages?.([{ event: replayEvent, data }], {
      rootSessionId: _trimStr(
        data?.route?.rootSessionId ||
        data?.route?.parentSessionId ||
        data?.rootSessionId ||
        data?.parentSessionId,
      ),
      dialogProcessId: _trimStr(data?.dialogProcessId),
      turnScopeId: replayTurnScopeId,
    }) || { applied: false, reason: "sub_session_projection_unavailable" };
  }
  if (WORKFLOW_RUNTIME_EVENT_NAMES.has(replayEvent)) {
    return applyWorkflowRuntimeEvent?.(replayEvent, data || {}) || {
      applied: false,
      reason: "workflow_runtime_projection_unavailable",
    };
  }
  if (replayEvent === StreamEventEnum.EXECUTION_SNAPSHOT) return applyExecutionSnapshot?.(data || {});
  if (replayEvent === StreamEventEnum.EXECUTION_CHILDREN) return applyExecutionChildren?.(data || {});
  if (replayEvent === StreamEventEnum.EXECUTION_TREE) return applyExecutionTree?.(data || {});
  if (replayEvent === StreamEventEnum.TURN_SNAPSHOT) {
    return applyTurnLifecycleSnapshot?.(data || {});
  }
  if (replayEvent === StreamEventEnum.TURN_LIFECYCLE) {
    return applyTurnLifecycleEnvelope?.(data || {});
  }
  if (replayEvent === StreamEventEnum.CHANNEL_STATE) {
    const stateData = data || {};
    const sessionId = _trimStr(stateData.sessionId);
    const turnScopeId = _trimStr(stateData.turnScopeId || stateData.messageEvent?.turnScopeId);
    const state = _trimStr(stateData.state || stateData.channelState);
    const terminalStates = new Set([
      BackendChannelState.COMPLETED,
      BackendChannelState.ERROR,
      BackendChannelState.USER_STOPPED,
      BackendChannelState.CANCELLED,
      BackendChannelState.EXPIRED,
      BackendChannelState.NO_CONVERSATION,
    ]);
    const authoritativeSnapshot =
      sessionId && turnScopeId && terminalStates.has(state)
        ? hasAuthoritativeCurrentRun?.({ sessionId, turnScopeId }) === true
        : stateData.authoritativeSnapshot === true;
    return applyChannelState({
      ...stateData,
      ...(terminalStates.has(state) ? { authoritativeSnapshot } : {}),
    });
  }

  const dialogProcessId = _trimStr(data?.dialogProcessId);
  const sessionId = _trimStr(data?.sessionId);
  const turnScopeId = _trimStr(data?.turnScopeId || data?.messageEvent?.turnScopeId);
  if (sessionId && isCurrentActiveSession(sessionId)) {
    await consumeReplayCacheForSession(sessionId);
    await applyReconnectMessagesToActiveSession([{ event: replayEvent, data }], dialogProcessId, {
      turnScopeId,
    });
    if (replayEvent === StreamEventEnum.DONE) {
      await finalizeDoneTurnPresentation?.(data || {});
      const authoritativeSnapshot = hasAuthoritativeCurrentRun?.({
        sessionId,
        turnScopeId,
      }) === true;
      await applyChannelState({
        ...(data || {}),
        sessionId,
        dialogProcessId,
        state: BackendChannelState.COMPLETED,
        sourceEvent: "done",
        authoritativeSnapshot,
      });
    }
    return;
  }

  if (!sessionId && dialogProcessId && isCurrentActiveDialogProcess?.(dialogProcessId)) {
    await applyReconnectMessagesToActiveSession([{ event: replayEvent, data }], dialogProcessId, {
      turnScopeId,
    });
    if (replayEvent === StreamEventEnum.DONE) {
      await finalizeDoneTurnPresentation?.(data || {});
      await applyChannelState({
        ...(data || {}),
        dialogProcessId,
        state: BackendChannelState.COMPLETED,
        sourceEvent: "done",
        authoritativeSnapshot: false,
      });
    }
    return;
  }

  if (sessionId) {
    const replayKey = normalizeReplayCacheKey(dialogProcessId, sessionId, turnScopeId);
    if (!replayCache[sessionId]) replayCache[sessionId] = {};
    if (!replayCache[sessionId][replayKey]) replayCache[sessionId][replayKey] = [];
    replayCache[sessionId][replayKey].push({ event: replayEvent, data });
  }
}
