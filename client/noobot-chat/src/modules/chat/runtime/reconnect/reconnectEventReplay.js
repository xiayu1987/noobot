/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StreamEventEnum } from "../../model/chatConstants.js";
import { EVENT_FAMILY, validateProtocolEvent } from "@noobot/event-protocol";
import { normalizeReplayCacheKey } from "./replayCache.js";
import { _trimStr } from "./utils.js";
import { normalizeTurnTransportEnvelope } from "../engine/turnTransportEnvelope.js";
import {
  logStateMachineDebug,
  summarizeTurnLifecycleSnapshot,
} from "../../../debug/loggers/stateMachineLogger.js";

export async function applyReconnectEventReplay({
  event: incomingEvent,
  data: incomingData,
  replayCache,
  isCurrentActiveSession,
  consumeReplayCacheForSession,
  applyReconnectMessagesToActiveSession,
  applyTurnLifecycleEnvelope,
  applyTurnLifecycleSnapshot,
  applyExecutionSnapshot,
  applyExecutionChildren,
  applyExecutionTree,
  applyWorkflowRuntimeEvent,
  applyPendingInteraction,
  applySubSessionReplayMessages,
  onAttachmentLifecycle,
  isDeletedTurn,
} = {}) {
  const normalizedTransportEnvelope = normalizeTurnTransportEnvelope({
    event: incomingEvent,
    data: incomingData,
    source: "reconnect",
  });
  const replayEvent = normalizedTransportEnvelope.event;
  const data = normalizedTransportEnvelope.data;
  if (replayEvent === StreamEventEnum.CHANNEL_STATE) {
    return { applied: false, reason: "transport_channel_state_ignored" };
  }
  const protocolResult = validateProtocolEvent(data);
  if (!protocolResult.valid || data?.identity?.eventType !== replayEvent) {
    return {
      applied: false,
      reason: "unsupported_replay_event",
      errors: protocolResult.valid ? ["transport_event_identity_mismatch"] : protocolResult.errors,
    };
  }
  const replaySessionId = _trimStr(data.identity.sessionId);
  const replayTurnScopeId = _trimStr(data.identity.turnScopeId);
  logStateMachineDebug("stateMachine.reconnect.event.received", () => ({
    sessionId: replaySessionId,
    turnScopeId: replayTurnScopeId,
    protocolEvent: replayEvent,
    dialogProcessId: _trimStr(data.payload?.dialogProcessId),
    commandId: _trimStr(data.causality?.commandId),
    lifecycleSequence: Number(data.ordering.sequence),
  }));
  if (isDeletedTurn?.({ sessionId: replaySessionId, turnScopeId: replayTurnScopeId }) === true) {
    return { applied: false, reason: "deleted_turn_tombstoned" };
  }
  if (protocolResult.descriptor.family === EVENT_FAMILY.MESSAGE_TIMELINE) {
    if (data.payload.workflowRunId && data.payload.nodeExecutionId) {
      return applySubSessionReplayMessages?.([data], {
        rootSessionId: data.payload.parentSessionId,
        dialogProcessId: data.payload.dialogProcessId,
        turnScopeId: replayTurnScopeId,
      }) || { applied: false, reason: "sub_session_message_projection_unavailable" };
    }
    const dialogProcessId = _trimStr(data.payload.dialogProcessId);
    const sessionId = replaySessionId;
    const turnScopeId = replayTurnScopeId;
    if (!sessionId || !turnScopeId) {
      return { applied: false, reason: "message_event_missing_turn_identity" };
    }
    if (isCurrentActiveSession(sessionId)) {
      await consumeReplayCacheForSession(sessionId);
      await applyReconnectMessagesToActiveSession([data], dialogProcessId, {
        turnScopeId,
      });
      return { applied: true, reason: "message_event_replayed" };
    }
    const replayKey = normalizeReplayCacheKey(sessionId, turnScopeId);
    if (!replayCache[sessionId]) replayCache[sessionId] = {};
    if (!replayCache[sessionId][replayKey]) replayCache[sessionId][replayKey] = [];
    replayCache[sessionId][replayKey].push(data);
    return { applied: false, reason: "message_event_cached" };
  }
  if (protocolResult.descriptor.family === EVENT_FAMILY.WORKFLOW_RUNTIME) {
    return applyWorkflowRuntimeEvent?.(data, { source: "reconnect" })
      || { applied: false, reason: "workflow_runtime_projection_unavailable" };
  }
  if (protocolResult.descriptor.family === EVENT_FAMILY.INTERACTION_REQUEST) {
    return applyPendingInteraction?.(data.payload)
      || { applied: false, reason: "interaction_projection_unavailable" };
  }
  if (protocolResult.descriptor.family === EVENT_FAMILY.ATTACHMENT_LIFECYCLE) {
    onAttachmentLifecycle?.(data.payload);
    return { applied: true, reason: "attachment_lifecycle_projected" };
  }
  if (replayEvent === StreamEventEnum.EXECUTION_SNAPSHOT)
    return applyExecutionSnapshot?.(data.payload);
  if (replayEvent === StreamEventEnum.EXECUTION_CHILDREN)
    return applyExecutionChildren?.(data.payload);
  if (replayEvent === StreamEventEnum.EXECUTION_TREE) return applyExecutionTree?.(data.payload);
  if (replayEvent === StreamEventEnum.TURN_LIFECYCLE) {
    return applyTurnLifecycleEnvelope?.(data);
  }
  return { applied: false, reason: "replay_reducer_unavailable" };
}
