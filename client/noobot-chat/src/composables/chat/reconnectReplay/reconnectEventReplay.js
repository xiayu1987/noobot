/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StreamEventEnum } from "../../../shared/constants/chatConstants";
import { BackendChannelState } from "../sessionRunStateMachine";
import { normalizeReplayCacheKey } from "./replayCache";
import { _trimStr } from "./utils";

export async function applyReconnectEventReplay({
  event,
  data,
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
} = {}) {
  if (_trimStr(event) === StreamEventEnum.EXECUTION_SNAPSHOT) return applyExecutionSnapshot?.(data || {});
  if (_trimStr(event) === StreamEventEnum.EXECUTION_CHILDREN) return applyExecutionChildren?.(data || {});
  if (_trimStr(event) === StreamEventEnum.EXECUTION_TREE) return applyExecutionTree?.(data || {});
  if (_trimStr(event) === StreamEventEnum.TURN_SNAPSHOT) {
    return applyTurnLifecycleSnapshot?.(data || {});
  }
  if (_trimStr(event) === StreamEventEnum.TURN_LIFECYCLE) {
    return applyTurnLifecycleEnvelope?.(data || {});
  }
  if (_trimStr(event) === StreamEventEnum.CHANNEL_STATE) {
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
    await applyReconnectMessagesToActiveSession([{ event, data }], dialogProcessId, {
      turnScopeId,
    });
    if (_trimStr(event) === StreamEventEnum.DONE) {
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
    await applyReconnectMessagesToActiveSession([{ event, data }], dialogProcessId, {
      turnScopeId,
    });
    if (_trimStr(event) === StreamEventEnum.DONE) {
      await applyChannelState({
        ...(data || {}),
        dialogProcessId,
        state: BackendChannelState.COMPLETED,
        sourceEvent: "done",
        // A dialog-only payload cannot prove Turn ownership and therefore
        // cannot grant lifecycle completion authority.
        authoritativeSnapshot: false,
      });
    }
    return;
  }

  if (sessionId) {
    // New writes are physically isolated by canonical turn ownership. Legacy
    // dialog/session keys remain read-only compatible in replayCache.js.
    const replayKey = normalizeReplayCacheKey(dialogProcessId, sessionId, turnScopeId);
    if (!replayCache[sessionId]) replayCache[sessionId] = {};
    if (!replayCache[sessionId][replayKey]) replayCache[sessionId][replayKey] = [];
    replayCache[sessionId][replayKey].push({ event, data });
  }
}
