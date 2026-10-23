/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StreamEventEnum } from "../../model/chatConstants.js";
import { EVENT_FAMILY } from "@noobot/event-protocol";
import { normalizeReplayCacheKey } from "./replayCache.js";
import { _trimStr } from "./utils.js";
import { normalizeTurnTransportEnvelope } from "../engine/turnTransportEnvelope.js";
import { logStateMachineDebug } from "../../../debug/loggers/stateMachineLogger.js";
import { logThinkingReplayDebug } from "../../../debug/loggers/thinkingReplayDebugLogger.js";

export async function applyReconnectEventReplay({
  event: incomingEvent,
  data: incomingData,
  replayCache,
  isCurrentActiveSession,
  consumeReplayCacheForSession,
  applyReconnectMessagesToActiveSession,
  applyTurnLifecycleEnvelope,
  applyExecutionSnapshot,
  applyExecutionChildren,
  applyExecutionTree,
  applyWorkflowRuntimeEvent,
  applyRuntimeStreamEvent,
  applyPendingInteraction,
  applySubSessionReplayMessages,
  onAttachmentLifecycle,
  isDeletedTurn,
}) {
  const {
    event: replayEvent,
    data,
    protocolEnvelope,
    family,
    rejected,
  } = normalizeTurnTransportEnvelope({ event: incomingEvent, data: incomingData });
  if (replayEvent === StreamEventEnum.CHANNEL_STATE) {
    return { applied: false, reason: "transport_channel_state_ignored" };
  }
  if (!protocolEnvelope) {
    const errors = rejected ? rejected.errors : ["non_protocol_replay_event"];
    logThinkingReplayDebug("frontend.thinkingReplay.replayEventRejected", () => ({
      protocolEvent: replayEvent,
      reason: "unsupported_replay_event",
      errors,
    }));
    return { applied: false, reason: "unsupported_replay_event", errors };
  }
  const replaySessionId = protocolEnvelope.identity.sessionId;
  const replayTurnScopeId = protocolEnvelope.identity.turnScopeId;
  logStateMachineDebug("stateMachine.reconnect.event.received", () => ({
    sessionId: replaySessionId,
    turnScopeId: replayTurnScopeId,
    protocolEvent: replayEvent,
    dialogProcessId: _trimStr(protocolEnvelope.payload?.dialogProcessId),
    commandId: _trimStr(protocolEnvelope.causality?.commandId),
    lifecycleSequence: Number(protocolEnvelope.ordering.sequence),
  }));
  if (isDeletedTurn({ sessionId: replaySessionId, turnScopeId: replayTurnScopeId })) {
    logThinkingReplayDebug("frontend.thinkingReplay.replayEventRejected", () => ({
      sessionId: replaySessionId,
      turnScopeId: replayTurnScopeId,
      protocolEvent: replayEvent,
      reason: "deleted_turn_tombstoned",
    }));
    return { applied: false, reason: "deleted_turn_tombstoned" };
  }
  if (family === EVENT_FAMILY.MESSAGE_TIMELINE) {
    const envelope = protocolEnvelope;
    if (envelope.payload.workflowRunId && envelope.payload.nodeExecutionId) {
      return applySubSessionReplayMessages([envelope], {
        rootSessionId: envelope.payload.parentSessionId,
        dialogProcessId: envelope.payload.dialogProcessId,
        turnScopeId: replayTurnScopeId,
      });
    }
    const { dialogProcessId } = envelope.payload;
    const { sessionId, turnScopeId } = envelope.identity;
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
  if (family === EVENT_FAMILY.WORKFLOW_RUNTIME) {
    return applyWorkflowRuntimeEvent(protocolEnvelope, { source: "reconnect" });
  }
  if (family === EVENT_FAMILY.PLUGIN_ARTIFACT) {
    return applyRuntimeStreamEvent(protocolEnvelope, { source: "reconnect" });
  }
  if (family === EVENT_FAMILY.INTERACTION_REQUEST) {
    return applyPendingInteraction(data);
  }
  if (family === EVENT_FAMILY.ATTACHMENT_LIFECYCLE) {
    onAttachmentLifecycle(protocolEnvelope.payload);
    return { applied: true, reason: "attachment_lifecycle_projected" };
  }
  if (replayEvent === StreamEventEnum.EXECUTION_SNAPSHOT)
    return applyExecutionSnapshot(protocolEnvelope.payload);
  if (replayEvent === StreamEventEnum.EXECUTION_CHILDREN)
    return applyExecutionChildren(protocolEnvelope.payload);
  if (replayEvent === StreamEventEnum.EXECUTION_TREE)
    return applyExecutionTree(protocolEnvelope.payload);
  if (replayEvent === StreamEventEnum.TURN_LIFECYCLE) {
    return applyTurnLifecycleEnvelope(data);
  }
  return { applied: false, reason: "replay_reducer_unavailable" };
}
