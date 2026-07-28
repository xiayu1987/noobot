/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StreamEventEnum } from "../../model/chatConstants.js";
import { BackendChannelState } from "../sessionRunStateMachine.js";
import { normalizeReplayCacheKey } from "./replayCache.js";
import { _trimStr } from "./utils.js";
import { normalizeTurnTransportEnvelope } from "../engine/turnTransportEnvelope.js";
import { routeRuntimeStreamEvent } from "../../../../extensions/runtime-stream-router.js";

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
  let runtimeResult = null;
  const runtimeRouted = routeRuntimeStreamEvent(replayEvent, data, {
    source: "reconnect",
    applyWorkflowRuntimeEvent: (record, options) => {
      runtimeResult = applyWorkflowRuntimeEvent?.(record?.event || replayEvent, record?.data || data, options);
      return runtimeResult;
    },
  });
  if (runtimeRouted) return runtimeResult || { applied: true };
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
