/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StreamEventEnum } from "../../../shared/constants/chatConstants";
import { BackendChannelState } from "../sessionRunStateMachine";
import { normalizeReplayCacheKey } from "./replayCache";
import { _trimStr } from "./utils";

const WORKFLOW_RUNTIME_EVENT_NAMES = new Set([
  "workflow_planning_message_prepared",
  "workflow_node_state_committed",
]);

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
  applyWorkflowRuntimeEvent,
  applySubSessionReplayMessages,
  finalizeDoneSessionDetail,
  isDeletedTurn,
} = {}) {
  const replayEvent = _trimStr(event);
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
    await applyReconnectMessagesToActiveSession([{ event, data }], dialogProcessId, {
      turnScopeId,
    });
    if (_trimStr(event) === StreamEventEnum.DONE) {
      await finalizeDoneSessionDetail?.(data || {});
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
      await finalizeDoneSessionDetail?.(data || {});
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
