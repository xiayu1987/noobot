/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StreamEventEnum } from "../../model/chatConstants.js";
import {
  getReconnectEnvelopeSequence,
  getReconnectMaxSequence,
  isPendingInteractionReplay,
} from "../../model/reconnectReplayModel.js";
import { _ensureArray, _trimStr } from "./utils.js";
import { logThinkingReplayDebug } from "../../../debug/loggers/thinkingReplayDebugLogger.js";
import { dispatchTurnEnvelope, TURN_PROJECTION_SOURCE } from "../engine/turnProjectionStore.js";
import { logWorkflowDiagnostics } from "../../../debug/loggers/workflowDiagnosticsLogger.js";
import { resolveMessageEventPresentationId } from "@noobot/shared/message-event-protocol";

function summarizeReconnectEnvelope(envelope = {}) {
  return {
    event: _trimStr(envelope?.event),
    transportSequence: getReconnectEnvelopeSequence(envelope),
    messageSequence: Number(
      envelope?.data?.event?.sequence || envelope?.data?.messageEvent?.sequence || 0,
    ) || null,
    hasDoneMessages: Boolean(
      _trimStr(envelope?.event) === StreamEventEnum.DONE &&
      Array.isArray(envelope?.data?.messages) &&
      envelope.data.messages.length,
    ),
  };
}

export function prepareReconnectReplayMessages({
  messages = [],
  lastAppliedSeq = 0,
  lastAppliedEventKinds = null,
} = {}) {
  const normalizedLastAppliedSeq = Number(lastAppliedSeq || 0);
  const boundaryEventKinds = Array.isArray(lastAppliedEventKinds)
    ? new Set(lastAppliedEventKinds.map((value) => _trimStr(value)).filter(Boolean))
    : null;
  const nextMessages = (_ensureArray(messages)).filter((envelope) => {
    if (isPendingInteractionReplay(envelope)) return true;
    const sequence = getReconnectEnvelopeSequence(envelope);
    if (!sequence || sequence > normalizedLastAppliedSeq) return true;
    if (sequence < normalizedLastAppliedSeq || !boundaryEventKinds) return false;
    return !boundaryEventKinds.has(_trimStr(envelope?.event));
  });
  return {
    nextMessages,
    maxSequence: getReconnectMaxSequence(nextMessages, normalizedLastAppliedSeq),
  };
}

export function shouldSkipReconnectBatchAfterTerminal({
  normalizedDpId = "",
  terminalDialogProcessIdSet,
  nextMessages = [],
  isReconnectTerminalBatch,
} = {}) {
  return Boolean(
    normalizedDpId &&
      terminalDialogProcessIdSet?.has?.(normalizedDpId) &&
      !isReconnectTerminalBatch?.(nextMessages),
  );
}

export function prepareReconnectReplayBatchPlan({
  messages = [],
  lastAppliedSeq = 0,
  lastAppliedEventKinds = null,
  normalizedDpId = "",
  terminalDialogProcessIdSet,
  isReconnectTerminalBatch,
} = {}) {
  const { nextMessages, maxSequence } = prepareReconnectReplayMessages({
    messages,
    lastAppliedSeq,
    lastAppliedEventKinds,
  });
  const shouldSkipAfterTerminal = shouldSkipReconnectBatchAfterTerminal({
    normalizedDpId,
    terminalDialogProcessIdSet,
    nextMessages,
    isReconnectTerminalBatch,
  });
  const batchHasTerminalEvent = isReconnectTerminalBatch?.(nextMessages) || false;
  return {
    nextMessages,
    maxSequence,
    shouldSkipAfterTerminal,
    batchHasTerminalEvent,
  };
}

export function applyReconnectEnvelopeToTargetMessage({
  envelope,
  findCanonicalMessageById,
  normalizedDpId = "",
  terminalDialogProcessIdSet,
  isReconnectTerminalEvent,
  classifyRealtimeLog,
  normalizeExecutionLogForRealtime,
  onInteractionRequest,
  onConnectorStatus,
  onAttachments,
  processStore,
} = {}) {
  const eventName = _trimStr(envelope?.event);
  const eventData = envelope?.data || {};
  if (
    terminalDialogProcessIdSet?.has?.(normalizedDpId) &&
    !isReconnectTerminalEvent?.(eventName)
  ) {
    return false;
  }
  if (eventName === "message_event") {
    const messageEvent = eventData?.event;
    const sourceMessageId = _trimStr(messageEvent?.messageId);
    const presentationMessageId = resolveMessageEventPresentationId(messageEvent);
    if (!sourceMessageId || !presentationMessageId) {
      logWorkflowDiagnostics("frontend.workflowReplay.messageEventRejected", () => ({
        sessionId: _trimStr(messageEvent?.sessionId || eventData?.sessionId),
        dialogProcessId: _trimStr(messageEvent?.dialogProcessId || eventData?.dialogProcessId || normalizedDpId),
        turnScopeId: _trimStr(messageEvent?.turnScopeId || eventData?.turnScopeId),
        reason: !sourceMessageId ? "missing_message_id" : "missing_presentation_message_id",
      }));
      return false;
    }
    const targetSessionId = _trimStr(messageEvent?.sessionId || eventData?.sessionId);
    const canonicalTarget = findCanonicalMessageById?.(targetSessionId, presentationMessageId);
    if (
      !canonicalTarget ||
      _trimStr(canonicalTarget?.messageId || canonicalTarget?.id) !== presentationMessageId
    ) {
      logWorkflowDiagnostics("frontend.workflowReplay.messageEventRejected", () => ({
        sessionId: _trimStr(messageEvent?.sessionId || eventData?.sessionId),
        dialogProcessId: _trimStr(messageEvent?.dialogProcessId || eventData?.dialogProcessId || normalizedDpId),
        turnScopeId: _trimStr(messageEvent?.turnScopeId || eventData?.turnScopeId),
        messageId: sourceMessageId,
        presentationMessageId,
        reason: "target_missing",
      }));
      return false;
    }
    const reduction = dispatchTurnEnvelope({
      targetMessage: canonicalTarget,
      envelope: messageEvent,
      classifyRealtimeLog,
      source: TURN_PROJECTION_SOURCE.HISTORY_REPLAY,
    });
    logThinkingReplayDebug("frontend.messageEvent.reduced", () => ({
      source: "history_replay",
      sessionId: String(messageEvent?.sessionId || eventData?.sessionId || ""),
      dialogProcessId: String(messageEvent?.dialogProcessId || eventData?.dialogProcessId || normalizedDpId),
      turnScopeId: String(messageEvent?.turnScopeId || eventData?.turnScopeId || ""),
      messageId: String(messageEvent?.messageId || ""),
      presentationMessageId,
      eventId: String(messageEvent?.eventId || ""),
      eventType: String(messageEvent?.eventType || ""),
      sequence: messageEvent?.sequence ?? envelope?.sequence ?? null,
      result: reduction.result,
      errors: reduction.errors || [],
    }));
  } else if (
    eventName === StreamEventEnum.INTERACTION_REQUEST ||
    eventName === StreamEventEnum.CONNECTOR_STATUS
  ) {
    if (eventName === StreamEventEnum.INTERACTION_REQUEST) onInteractionRequest?.(eventData);
    else onConnectorStatus?.(eventData);
  } else if (
    eventName === StreamEventEnum.USER_STOPPED ||
    eventName === StreamEventEnum.DONE ||
    eventName === StreamEventEnum.ERROR
  ) {
    terminalDialogProcessIdSet?.add?.(normalizedDpId);
    logWorkflowDiagnostics("frontend.workflowReplay.legacyMessageMutationSkipped", () => ({
      dialogProcessId: _trimStr(normalizedDpId),
      turnScopeId: _trimStr(eventData?.turnScopeId),
      event: eventName,
      reason: "stable_message_id_required",
    }));
  } else {
    logWorkflowDiagnostics("frontend.workflowReplay.legacyMessageMutationSkipped", () => ({
      dialogProcessId: _trimStr(normalizedDpId),
      turnScopeId: _trimStr(eventData?.turnScopeId),
      event: eventName,
      reason: "stable_message_id_required",
    }));
    return false;
  }
  return true;
}

export function applyReconnectEnvelopeBatchToTargetMessage({
  messages = [],
  findCanonicalMessageById,
  normalizedDpId = "",
  lastAppliedSeq = 0,
  terminalDialogProcessIdSet,
  isReconnectTerminalEvent,
  classifyRealtimeLog,
  normalizeExecutionLogForRealtime,
  onInteractionRequest,
  onConnectorStatus,
  onAttachments,
  processStore,
} = {}) {
  let maxAppliedSeq = Number(lastAppliedSeq || 0);
  for (const envelope of _ensureArray(messages)) {
    maxAppliedSeq = Math.max(maxAppliedSeq, getReconnectEnvelopeSequence(envelope));
    applyReconnectEnvelopeToTargetMessage({
      envelope,
      findCanonicalMessageById,
      normalizedDpId,
      terminalDialogProcessIdSet,
      isReconnectTerminalEvent,
      classifyRealtimeLog,
      normalizeExecutionLogForRealtime,
      onInteractionRequest,
      onConnectorStatus,
      onAttachments,
      processStore,
    });
  }
  return maxAppliedSeq;
}

export function buildReconnectReplayEnvelopeCallbacks({
  onInteractionRequest,
  onConnectorStatus,
  onAttachments,
} = {}) {
  return {
    onInteractionRequest: (eventData) => onInteractionRequest?.(eventData),
    onConnectorStatus: (eventData) => onConnectorStatus?.(eventData),
    onAttachments: (targetMessage, attachments = []) =>
      onAttachments?.(targetMessage, attachments),
  };
}

export function finalizeReconnectReplayBatch({
  normalizedDpId = "",
  sessionId = "",
  turnScopeId = "",
  maxAppliedSeq = 0,
  eventKindsAtSequence = [],
  markReconnectSequenceApplied,
  navigateToLastMessage,
  shouldNavigate = false,
} = {}) {
  markReconnectSequenceApplied?.(normalizedDpId, maxAppliedSeq, {
    sessionId,
    turnScopeId,
    eventKindsAtSequence,
  });
  if (shouldNavigate) navigateToLastMessage?.();
}


export async function applyReconnectReplayBatchToActiveSession({
  activeSession,
  activeSessionId,
  findCanonicalMessageById,
  chatList,
  messages = [],
  dialogProcessId = "",
  turnScopeId = "",
  lastAppliedSeq = 0,
  lastAppliedEventKinds = null,
  terminalDialogProcessIdSet,
  isReconnectTerminalBatch,
  isReconnectTerminalEvent,
  classifyRealtimeLog,
  normalizeExecutionLogForRealtime,
  envelopeCallbacks = {},
  markReconnectSequenceApplied,
  navigateToLastMessage,
  processStore,
} = {}) {
  if (!activeSession?.value) return false;
  const normalizedDpId = _trimStr(dialogProcessId);
  const envelopeTurnScopeIds = new Set(
    _ensureArray(messages)
      .map(({ data } = {}) => _trimStr(
        data?.turnScopeId || data?.event?.turnScopeId || data?.messageEvent?.turnScopeId,
      ))
      .filter(Boolean),
  );
  const normalizedTurnScopeId =
    _trimStr(turnScopeId) || (envelopeTurnScopeIds.size === 1 ? [...envelopeTurnScopeIds][0] : "");
  const {
    nextMessages,
    maxSequence,
    shouldSkipAfterTerminal,
  } = prepareReconnectReplayBatchPlan({
    messages,
    lastAppliedSeq,
    lastAppliedEventKinds,
    normalizedDpId,
    turnScopeId: normalizedTurnScopeId,
    terminalDialogProcessIdSet,
    isReconnectTerminalBatch,
  });
  logThinkingReplayDebug("frontend.thinkingReplay.reconnectBatchPlanned", () => ({
    sessionId: _trimStr(activeSession.value?.backendSessionId || activeSession.value?.id),
    dialogProcessId: normalizedDpId,
    turnScopeId: normalizedTurnScopeId,
    inputCount: _ensureArray(messages).length,
    replayCount: nextMessages.length,
    filteredCount: Math.max(0, _ensureArray(messages).length - nextMessages.length),
    lastAppliedSeq: Number(lastAppliedSeq || 0),
    maxSequence,
    shouldSkipAfterTerminal,
  }));
  logWorkflowDiagnostics("frontend.workflowReplay.reconnectBatchPlanned", () => ({
    sessionId: _trimStr(activeSession.value?.backendSessionId || activeSession.value?.id),
    dialogProcessId: normalizedDpId,
    turnScopeId: normalizedTurnScopeId,
    inputCount: _ensureArray(messages).length,
    replayCount: nextMessages.length,
    filteredCount: Math.max(0, _ensureArray(messages).length - nextMessages.length),
    lastAppliedTransportSequence: Number(lastAppliedSeq || 0),
    lastAppliedTransportEventKinds: Array.isArray(lastAppliedEventKinds)
      ? lastAppliedEventKinds
      : null,
    maxTransportSequence: maxSequence,
    terminalDialogSeen: Boolean(
      normalizedDpId && terminalDialogProcessIdSet?.has?.(normalizedDpId),
    ),
    shouldSkipAfterTerminal,
    inputEnvelopes: _ensureArray(messages).map(summarizeReconnectEnvelope),
    replayEnvelopes: nextMessages.map(summarizeReconnectEnvelope),
  }));
  if (!nextMessages.length) {
    logWorkflowDiagnostics("frontend.workflowReplay.reconnectBatchIgnored", () => ({
      sessionId: _trimStr(activeSession.value?.backendSessionId || activeSession.value?.id),
      dialogProcessId: normalizedDpId,
      turnScopeId: normalizedTurnScopeId,
      reason: "all_envelopes_filtered_by_transport_cursor",
      lastAppliedTransportSequence: Number(lastAppliedSeq || 0),
      inputEnvelopes: _ensureArray(messages).map(summarizeReconnectEnvelope),
    }));
    return false;
  }
  const eventKindsAtMaxSequence = Array.from(new Set(
    nextMessages
      .filter((envelope) => getReconnectEnvelopeSequence(envelope) === maxSequence)
      .map((envelope) => _trimStr(envelope?.event))
      .filter(Boolean),
  )).sort();
  if (shouldSkipAfterTerminal) {
    finalizeReconnectReplayBatch({
      normalizedDpId,
      sessionId: _trimStr(activeSession.value?.backendSessionId || activeSession.value?.id),
      turnScopeId: normalizedTurnScopeId,
      maxAppliedSeq: maxSequence,
      eventKindsAtSequence: eventKindsAtMaxSequence,
      markReconnectSequenceApplied,
      navigateToLastMessage,
      shouldNavigate: false,
    });
    return true;
  }
  const maxAppliedSeq = applyReconnectEnvelopeBatchToTargetMessage({
    messages: nextMessages,
    findCanonicalMessageById,
    normalizedDpId,
    lastAppliedSeq,
    terminalDialogProcessIdSet,
    isReconnectTerminalEvent,
    classifyRealtimeLog,
    normalizeExecutionLogForRealtime,
    ...envelopeCallbacks,
    processStore,
  });
  finalizeReconnectReplayBatch({
    normalizedDpId,
    sessionId: _trimStr(activeSession.value?.backendSessionId || activeSession.value?.id),
    turnScopeId: normalizedTurnScopeId,
    maxAppliedSeq,
    eventKindsAtSequence: Array.from(new Set(
      nextMessages
        .filter((envelope) => getReconnectEnvelopeSequence(envelope) === maxAppliedSeq)
        .map((envelope) => _trimStr(envelope?.event))
        .filter(Boolean),
    )).sort(),
    markReconnectSequenceApplied,
    navigateToLastMessage,
  });
  return true;
}
