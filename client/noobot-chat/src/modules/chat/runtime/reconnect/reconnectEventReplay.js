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
  const protocolEnvelope = normalizedTransportEnvelope.protocolEnvelope;
  if (replayEvent === StreamEventEnum.CHANNEL_STATE) {
    return { applied: false, reason: "transport_channel_state_ignored" };
  }
  const protocolResult = validateProtocolEvent(protocolEnvelope);
  if (!protocolResult.valid || protocolEnvelope?.identity?.eventType !== replayEvent) {
    return {
      applied: false,
      reason: "unsupported_replay_event",
      errors: protocolResult.valid ? ["transport_event_identity_mismatch"] : protocolResult.errors,
    };
  }
  const replaySessionId = _trimStr(protocolEnvelope.identity.sessionId);
  const replayTurnScopeId = _trimStr(protocolEnvelope.identity.turnScopeId);
  logStateMachineDebug("stateMachine.reconnect.event.received", () => ({
    sessionId: replaySessionId,
    turnScopeId: replayTurnScopeId,
    protocolEvent: replayEvent,
    dialogProcessId: _trimStr(protocolEnvelope.payload?.dialogProcessId),
    commandId: _trimStr(protocolEnvelope.causality?.commandId),
    lifecycleSequence: Number(protocolEnvelope.ordering.sequence),
  }));
  if (isDeletedTurn?.({ sessionId: replaySessionId, turnScopeId: replayTurnScopeId }) === true) {
    return { applied: false, reason: "deleted_turn_tombstoned" };
  }
  if (protocolResult.descriptor.family === EVENT_FAMILY.MESSAGE_TIMELINE) {
    const envelope = protocolEnvelope;
    if (envelope.payload.workflowRunId && envelope.payload.nodeExecutionId) {
      return applySubSessionReplayMessages?.([envelope], {
        rootSessionId: envelope.payload.parentSessionId,
        dialogProcessId: envelope.payload.dialogProcessId,
        turnScopeId: replayTurnScopeId,
      }) || { applied: false, reason: "sub_session_message_projection_unavailable" };
    }
    const dialogProcessId = _trimStr(envelope.payload.dialogProcessId);
    const sessionId = replaySessionId;
    const turnScopeId = replayTurnScopeId;
    if (!sessionId || !turnScopeId) {
      return { applied: false, reason: "message_event_missing_turn_identity" };
    }
    if (isCurrentActiveSession(sessionId)) {
      await consumeReplayCacheForSession(sessionId);
      await applyReconnectMessagesToActiveSession([envelope], dialogProcessId, {
        turnScopeId,
      });
      return { applied: true, reason: "message_event_replayed" };
    }
    const replayKey = normalizeReplayCacheKey(sessionId, turnScopeId);
    if (!replayCache[sessionId]) replayCache[sessionId] = {};
    if (!replayCache[sessionId][replayKey]) replayCache[sessionId][replayKey] = [];
    replayCache[sessionId][replayKey].push(envelope);
    return { applied: false, reason: "message_event_cached" };
  }
  if (protocolResult.descriptor.family === EVENT_FAMILY.WORKFLOW_RUNTIME) {
    return applyWorkflowRuntimeEvent?.(protocolEnvelope, { source: "reconnect" })
      || { applied: false, reason: "workflow_runtime_projection_unavailable" };
  }
  if (protocolResult.descriptor.family === EVENT_FAMILY.INTERACTION_REQUEST) {
    return applyPendingInteraction?.(data)
      || { applied: false, reason: "interaction_projection_unavailable" };
  }
  if (protocolResult.descriptor.family === EVENT_FAMILY.ATTACHMENT_LIFECYCLE) {
    onAttachmentLifecycle?.(protocolEnvelope.payload);
    return { applied: true, reason: "attachment_lifecycle_projected" };
  }
  if (replayEvent === StreamEventEnum.EXECUTION_SNAPSHOT)
    return applyExecutionSnapshot?.(protocolEnvelope.payload);
  if (replayEvent === StreamEventEnum.EXECUTION_CHILDREN)
    return applyExecutionChildren?.(protocolEnvelope.payload);
  if (replayEvent === StreamEventEnum.EXECUTION_TREE) return applyExecutionTree?.(protocolEnvelope.payload);
  if (replayEvent === StreamEventEnum.TURN_LIFECYCLE) {
    return applyTurnLifecycleEnvelope?.(data);
  }
  return { applied: false, reason: "replay_reducer_unavailable" };
}
