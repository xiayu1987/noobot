/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { EVENT_FAMILY, validateProtocolEvent } from "@noobot/event-protocol";
import { _ensureArray, _trimStr } from "./utils.js";
import { logThinkingReplayDebug } from "../../../debug/loggers/thinkingReplayDebugLogger.js";
import { dispatchTurnEnvelope, TURN_PROJECTION_SOURCE } from "../engine/turnProjectionStore.js";
import { logWorkflowDiagnostics } from "../../../debug/loggers/workflowDiagnosticsLogger.js";
import {
  MESSAGE_EVENT_TYPE,
  resolveMessageEventPresentationId,
} from "@noobot/event-protocol/message-event";

function summarizeReconnectEnvelope(envelope = {}) {
  const validation = validateProtocolEvent(envelope);
  return {
    event: _trimStr(envelope?.identity?.eventType),
    eventId: _trimStr(envelope?.identity?.eventId),
    family: _trimStr(envelope?.protocol?.family),
    sequenceDomain: _trimStr(envelope?.ordering?.domain),
    sequenceScopeId: _trimStr(envelope?.ordering?.scopeId),
    sequence: Number(envelope?.ordering?.sequence || 0) || null,
    valid: validation.valid,
    errors: validation.errors,
  };
}

export function prepareReconnectReplayMessages({ messages = [] } = {}) {
  const nextMessages = _ensureArray(messages).filter((envelope) => {
    const result = validateProtocolEvent(envelope);
    return result.valid && result.descriptor?.family === EVENT_FAMILY.MESSAGE_TIMELINE;
  });
  return { nextMessages };
}

export function shouldSkipReconnectBatchAfterTerminal({} = {}) {
  return false;
}

export function prepareReconnectReplayBatchPlan({ messages = [] } = {}) {
  return prepareReconnectReplayMessages({ messages });
}

export function applyReconnectEnvelopeToTargetMessage({
  envelope,
  findCanonicalMessageById,
  findCanonicalMessagesById,
  materializeTurnPresentation,
  normalizedDpId = "",
  classifyRealtimeLog,
} = {}) {
  const validation = validateProtocolEvent(envelope);
  if (!validation.valid || validation.descriptor?.family !== EVENT_FAMILY.MESSAGE_TIMELINE) {
    return false;
  }
  const sourceMessageId = _trimStr(envelope.identity.messageId);
  const presentationMessageId = resolveMessageEventPresentationId(envelope.payload);
  if (!sourceMessageId || !presentationMessageId) return false;
  const targetSessionId = _trimStr(envelope.identity.sessionId);
  if (envelope.payload.eventType === MESSAGE_EVENT_TYPE.TURN_PRESENTATION_COMMITTED) {
    const materialized = materializeTurnPresentation?.(envelope);
    logThinkingReplayDebug("frontend.thinkingReplay.presentationMaterialized", () => ({
      sessionId: targetSessionId,
      turnScopeId: _trimStr(envelope.identity.turnScopeId),
      presentationMessageId,
      applied: materialized?.applied === true,
      reason: materialized?.reason || "",
      createdCount: Number(materialized?.createdCount || 0),
    }));
    if (materialized?.applied !== true) return false;
  }
  const canonicalTargets =
    findCanonicalMessagesById?.(targetSessionId, presentationMessageId) ||
    [findCanonicalMessageById?.(targetSessionId, presentationMessageId)].filter(Boolean);
  const canonicalTarget = canonicalTargets[canonicalTargets.length - 1] || null;
  if (
    !canonicalTarget ||
    ![canonicalTarget?.messageId, canonicalTarget?.presentationMessageId, canonicalTarget?.id].some(
      (candidate) => _trimStr(candidate) === presentationMessageId,
    )
  )
    return false;
  const reductions = canonicalTargets.map((targetMessage) =>
    dispatchTurnEnvelope({
      targetMessage,
      envelope,
      classifyRealtimeLog,
      source: TURN_PROJECTION_SOURCE.HISTORY_REPLAY,
    }),
  );
  const reduction = reductions.find((item) => item.applied) ||
    reductions[0] || { result: "target_missing" };
  logThinkingReplayDebug("frontend.messageEvent.reduced", () => ({
    source: "history_replay",
    sessionId: String(envelope.identity.sessionId),
    dialogProcessId: String(envelope.payload.dialogProcessId || normalizedDpId),
    turnScopeId: String(envelope.identity.turnScopeId || ""),
    messageId: sourceMessageId,
    presentationMessageId,
    eventId: String(envelope.identity.eventId),
    eventType: String(envelope.payload.eventType),
    sequence: envelope.ordering.sequence,
    result: reduction.result,
    errors: reduction.errors || [],
  }));
  return true;
}

export function applyReconnectEnvelopeBatchToTargetMessage({
  messages = [],
  findCanonicalMessageById,
  findCanonicalMessagesById,
  materializeTurnPresentation,
  normalizedDpId = "",
  classifyRealtimeLog,
} = {}) {
  let appliedCount = 0;
  for (const envelope of _ensureArray(messages)) {
    if (
      applyReconnectEnvelopeToTargetMessage({
        envelope,
        findCanonicalMessageById,
        findCanonicalMessagesById,
        materializeTurnPresentation,
        normalizedDpId,
        classifyRealtimeLog,
      })
    )
      appliedCount += 1;
  }
  return appliedCount;
}

export function buildReconnectReplayEnvelopeCallbacks({
  onInteractionRequest,
  onConnectorStatus,
  onAttachments,
} = {}) {
  return {
    onInteractionRequest: (eventData) => onInteractionRequest?.(eventData),
    onConnectorStatus: (eventData) => onConnectorStatus?.(eventData),
    onAttachments: (targetMessage, attachments = []) => onAttachments?.(targetMessage, attachments),
  };
}

export async function applyReconnectReplayBatchToActiveSession({
  activeSession,
  activeSessionId,
  findCanonicalMessageById,
  findCanonicalMessagesById,
  materializeTurnPresentation,
  chatList,
  messages = [],
  dialogProcessId = "",
  turnScopeId = "",
  classifyRealtimeLog,
  navigateToLastMessage,
} = {}) {
  if (!activeSession?.value) return false;
  const normalizedDpId = _trimStr(dialogProcessId);
  const envelopeTurnScopeIds = new Set(
    _ensureArray(messages)
      .map((envelope) => _trimStr(envelope?.identity?.turnScopeId))
      .filter(Boolean),
  );
  const normalizedTurnScopeId =
    _trimStr(turnScopeId) || (envelopeTurnScopeIds.size === 1 ? [...envelopeTurnScopeIds][0] : "");
  const { nextMessages } = prepareReconnectReplayBatchPlan({ messages });
  logThinkingReplayDebug("frontend.thinkingReplay.reconnectBatchPlanned", () => ({
    sessionId: _trimStr(activeSession.value?.sessionId),
    dialogProcessId: normalizedDpId,
    turnScopeId: normalizedTurnScopeId,
    inputCount: _ensureArray(messages).length,
    replayCount: nextMessages.length,
    filteredCount: Math.max(0, _ensureArray(messages).length - nextMessages.length),
  }));
  logWorkflowDiagnostics("frontend.workflowReplay.reconnectBatchPlanned", () => ({
    sessionId: _trimStr(activeSession.value?.sessionId),
    dialogProcessId: normalizedDpId,
    turnScopeId: normalizedTurnScopeId,
    inputCount: _ensureArray(messages).length,
    replayCount: nextMessages.length,
    filteredCount: Math.max(0, _ensureArray(messages).length - nextMessages.length),
    inputEnvelopes: _ensureArray(messages).map(summarizeReconnectEnvelope),
    replayEnvelopes: nextMessages.map(summarizeReconnectEnvelope),
  }));
  if (!nextMessages.length) {
    logWorkflowDiagnostics("frontend.workflowReplay.reconnectBatchIgnored", () => ({
      sessionId: _trimStr(activeSession.value?.sessionId),
      dialogProcessId: normalizedDpId,
      turnScopeId: normalizedTurnScopeId,
      reason: "no_valid_message_timeline_envelopes",
      inputEnvelopes: _ensureArray(messages).map(summarizeReconnectEnvelope),
    }));
    return false;
  }
  const appliedCount = applyReconnectEnvelopeBatchToTargetMessage({
    messages: nextMessages,
    findCanonicalMessageById,
    findCanonicalMessagesById,
    materializeTurnPresentation,
    normalizedDpId,
    classifyRealtimeLog,
  });
  if (appliedCount > 0) navigateToLastMessage?.();
  return appliedCount > 0;
}
