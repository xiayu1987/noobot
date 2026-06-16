/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum, StreamEventEnum } from "../../../shared/constants/chatConstants";
import { sanitizeExecutionLogForDisplay } from "../chatEngine/utils";
import {
  findReconnectDoneEnvelopeWithMessages,
  getReconnectEnvelopeSequence,
  getReconnectMaxSequence,
  isPendingInteractionReplay,
} from "../../infra/reconnectReplayModel";
import { _ensureArray, _trimStr } from "./utils";
import {
  hydrateSessionBeforeReconnectReplayIfNeeded,
} from "./hydrationReplay";
import {
  applyDoneRealtimeLogsFromReconnectBatch,
} from "./doneReplay";
import {
  createFinalAssistantFromReconnectReplay,
  resolveReconnectTargetAssistantMessage,
} from "./assistantMessageReplay";
import { mergeRealtimeLogs } from "./messageLookup";

export function prepareReconnectReplayMessages({
  messages = [],
  lastAppliedSeq = 0,
} = {}) {
  const normalizedLastAppliedSeq = Number(lastAppliedSeq || 0);
  const nextMessages = (_ensureArray(messages)).filter((envelope) => {
    if (isPendingInteractionReplay(envelope)) return true;
    const sequence = getReconnectEnvelopeSequence(envelope);
    return !sequence || sequence > normalizedLastAppliedSeq;
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
  normalizedDpId = "",
  terminalDialogProcessIdSet,
  isReconnectTerminalBatch,
  allowCreate = true,
} = {}) {
  const { nextMessages, maxSequence } = prepareReconnectReplayMessages({
    messages,
    lastAppliedSeq,
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
    shouldCreateTarget: Boolean(allowCreate) && !batchHasTerminalEvent,
  };
}

export function applyDoneSnapshotReconnectBatch({
  activeSession,
  messages = [],
  normalizedDpId = "",
  applyDoneMessages,
  classifyRealtimeLog,
  normalizeExecutionLogForRealtime,
} = {}) {
  const doneEnvelopeWithMessages = findReconnectDoneEnvelopeWithMessages(messages);
  if (!doneEnvelopeWithMessages) return false;
  applyDoneMessages?.(doneEnvelopeWithMessages.data || {});
  applyDoneRealtimeLogsFromReconnectBatch({
    activeSession,
    messages,
    normalizedDpId,
    classifyRealtimeLog,
    normalizeExecutionLogForRealtime,
  });
  return true;
}

export function applyReconnectFallbackAssistant({
  activeSession,
  appendMessage,
  messages = [],
  normalizedDpId = "",
} = {}) {
  createFinalAssistantFromReconnectReplay({
    activeSession,
    appendMessage,
    messages,
    dialogProcessId: normalizedDpId,
  });
}

export function resolveReconnectTargetOrApplyFallbackAssistant({
  activeSession,
  appendMessage,
  messages = [],
  normalizedDpId = "",
  allowCreate = true,
} = {}) {
  const targetMessage = resolveReconnectTargetAssistantMessage({
    activeSession,
    appendMessage,
    dialogProcessId: normalizedDpId,
    allowCreate,
  });
  if (targetMessage) {
    return { targetMessage, usedFallback: false };
  }
  applyReconnectFallbackAssistant({
    activeSession,
    appendMessage,
    messages,
    normalizedDpId,
  });
  return { targetMessage: null, usedFallback: true };
}

export function applyReconnectEnvelopeToTargetMessage({
  envelope,
  targetMessage,
  normalizedDpId = "",
  terminalDialogProcessIdSet,
  isReconnectTerminalEvent,
  classifyRealtimeLog,
  normalizeExecutionLogForRealtime,
  onInteractionRequest,
  onConnectorStatus,
  onAttachmentMetas,
  onDoneMessages,
} = {}) {
  if (!targetMessage) return false;
  const eventName = _trimStr(envelope?.event);
  const eventData = envelope?.data || {};
  if (
    terminalDialogProcessIdSet?.has?.(normalizedDpId) &&
    !isReconnectTerminalEvent?.(eventName)
  ) {
    return false;
  }
  if (eventName === StreamEventEnum.DELTA) {
    targetMessage.content += String(eventData?.text || "");
  } else if (eventName === StreamEventEnum.THINKING) {
    const logItem = sanitizeExecutionLogForDisplay(classifyRealtimeLog(eventData));
    if (!logItem || !_trimStr(logItem.text)) {
      return true;
    }
    if (logItem?.dialogProcessId && !_trimStr(targetMessage?.dialogProcessId)) {
      targetMessage.dialogProcessId = _trimStr(logItem.dialogProcessId);
    }
    targetMessage.executionLogTotal = Number(targetMessage.executionLogTotal || 0) + 1;
    mergeRealtimeLogs(targetMessage, [logItem]);
  } else if (eventName === StreamEventEnum.INTERACTION_REQUEST) {
    onInteractionRequest?.(eventData);
  } else if (eventName === StreamEventEnum.CONNECTOR_STATUS) {
    onConnectorStatus?.(eventData);
  } else if (eventName === StreamEventEnum.ATTACHMENT_METAS) {
    onAttachmentMetas?.(targetMessage, eventData?.attachmentMetas || []);
  } else if (eventName === StreamEventEnum.DONE) {
    terminalDialogProcessIdSet?.add?.(normalizedDpId);
    const executionSummarySteps = Array.isArray(eventData?.executionSummary?.steps)
      ? eventData.executionSummary.steps
      : [];
    const doneExecutionLogSource = executionSummarySteps.length
      ? executionSummarySteps
      : Array.isArray(eventData?.executionLogs)
        ? eventData.executionLogs
        : [];
    if (doneExecutionLogSource.length) {
      const doneRealtimeLogs = doneExecutionLogSource
        .map((executionLogItem) =>
          classifyRealtimeLog(normalizeExecutionLogForRealtime(executionLogItem)),
        )
        .map((logItem) => sanitizeExecutionLogForDisplay(logItem))
        .filter((logItem) => logItem && _trimStr(logItem.text));
      if (doneRealtimeLogs.length) {
        targetMessage.executionLogTotal = Math.max(
          Number(targetMessage.executionLogTotal || 0),
          doneRealtimeLogs.length,
          Number(eventData?.executionSummary?.returned || 0),
          Number(eventData?.executionLogs?.length || 0),
        );
        mergeRealtimeLogs(targetMessage, doneRealtimeLogs);
        if (!_trimStr(targetMessage?.dialogProcessId)) {
          const latestDialogProcessId = [...doneRealtimeLogs]
            .reverse()
            .map((logItem) => _trimStr(logItem?.dialogProcessId))
            .find(Boolean);
          if (latestDialogProcessId) {
            targetMessage.dialogProcessId = latestDialogProcessId;
          }
        }
      }
    }
    if (Array.isArray(eventData?.messages) && eventData.messages.length) {
      onDoneMessages?.(eventData);
    }
  } else if (eventName === StreamEventEnum.STOPPED) {
    terminalDialogProcessIdSet?.add?.(normalizedDpId);
  } else if (eventName === StreamEventEnum.ERROR) {
    targetMessage.error = String(eventData?.error || targetMessage?.error || "");
    terminalDialogProcessIdSet?.add?.(normalizedDpId);
  }
  return true;
}

export function applyReconnectEnvelopeBatchToTargetMessage({
  messages = [],
  targetMessage,
  normalizedDpId = "",
  lastAppliedSeq = 0,
  terminalDialogProcessIdSet,
  isReconnectTerminalEvent,
  classifyRealtimeLog,
  normalizeExecutionLogForRealtime,
  onInteractionRequest,
  onConnectorStatus,
  onAttachmentMetas,
  onDoneMessages,
} = {}) {
  let maxAppliedSeq = Number(lastAppliedSeq || 0);
  for (const envelope of _ensureArray(messages)) {
    maxAppliedSeq = Math.max(maxAppliedSeq, getReconnectEnvelopeSequence(envelope));
    applyReconnectEnvelopeToTargetMessage({
      envelope,
      targetMessage,
      normalizedDpId,
      terminalDialogProcessIdSet,
      isReconnectTerminalEvent,
      classifyRealtimeLog,
      normalizeExecutionLogForRealtime,
      onInteractionRequest,
      onConnectorStatus,
      onAttachmentMetas,
      onDoneMessages,
    });
  }
  return maxAppliedSeq;
}

export function buildReconnectReplayEnvelopeCallbacks({
  onInteractionRequest,
  onConnectorStatus,
  onAttachmentMetas,
  onDoneMessages,
} = {}) {
  return {
    onInteractionRequest: (eventData) => onInteractionRequest?.(eventData),
    onConnectorStatus: (eventData) => onConnectorStatus?.(eventData),
    onAttachmentMetas: (targetMessage, attachmentMetas = []) =>
      onAttachmentMetas?.(targetMessage, attachmentMetas),
    onDoneMessages: (eventData) => onDoneMessages?.(eventData),
  };
}

export function finalizeReconnectReplayBatch({
  normalizedDpId = "",
  maxAppliedSeq = 0,
  markReconnectSequenceApplied,
  scrollBottom,
  shouldScroll = true,
} = {}) {
  markReconnectSequenceApplied?.(normalizedDpId, maxAppliedSeq);
  if (shouldScroll) scrollBottom?.();
}


export async function applyReconnectReplayBatchToActiveSession({
  activeSession,
  activeSessionId,
  appendMessage,
  chatList,
  messages = [],
  dialogProcessId = "",
  allowCreate = true,
  lastAppliedSeq = 0,
  terminalDialogProcessIdSet,
  isReconnectTerminalBatch,
  isReconnectTerminalEvent,
  classifyRealtimeLog,
  normalizeExecutionLogForRealtime,
  getReplayHydrationPromise = () => null,
  setReplayHydrationPromise = () => {},
  onHydrationError = console.warn,
  applyDoneMessages,
  envelopeCallbacks = {},
  markReconnectSequenceApplied,
  scrollBottom,
} = {}) {
  if (!activeSession?.value) return false;
  const normalizedDpId = _trimStr(dialogProcessId);
  const {
    nextMessages,
    maxSequence,
    shouldSkipAfterTerminal,
    shouldCreateTarget,
  } = prepareReconnectReplayBatchPlan({
    messages,
    lastAppliedSeq,
    normalizedDpId,
    terminalDialogProcessIdSet,
    isReconnectTerminalBatch,
    allowCreate,
  });
  if (!nextMessages.length) return false;
  if (shouldSkipAfterTerminal) {
    finalizeReconnectReplayBatch({
      normalizedDpId,
      maxAppliedSeq: maxSequence,
      markReconnectSequenceApplied,
      scrollBottom,
      shouldScroll: false,
    });
    return true;
  }
  await hydrateSessionBeforeReconnectReplayIfNeeded({
    activeSession,
    activeSessionId,
    chatList,
    messages: nextMessages,
    dialogProcessId: normalizedDpId,
    allowCreate: shouldCreateTarget,
    getReplayHydrationPromise,
    setReplayHydrationPromise,
    onError: onHydrationError,
  });
  if (applyDoneSnapshotReconnectBatch({
    activeSession,
    messages: nextMessages,
    normalizedDpId,
    applyDoneMessages,
    classifyRealtimeLog,
    normalizeExecutionLogForRealtime,
  })) {
    finalizeReconnectReplayBatch({
      normalizedDpId,
      maxAppliedSeq: maxSequence,
      markReconnectSequenceApplied,
      scrollBottom,
    });
    return true;
  }

  const { targetMessage, usedFallback } = resolveReconnectTargetOrApplyFallbackAssistant({
    activeSession,
    appendMessage,
    messages: nextMessages,
    normalizedDpId,
    allowCreate: shouldCreateTarget,
  });
  if (usedFallback) {
    finalizeReconnectReplayBatch({
      normalizedDpId,
      maxAppliedSeq: maxSequence,
      markReconnectSequenceApplied,
      scrollBottom,
    });
    return true;
  }
  const maxAppliedSeq = applyReconnectEnvelopeBatchToTargetMessage({
    messages: nextMessages,
    targetMessage,
    normalizedDpId,
    lastAppliedSeq,
    terminalDialogProcessIdSet,
    isReconnectTerminalEvent,
    classifyRealtimeLog,
    normalizeExecutionLogForRealtime,
    ...envelopeCallbacks,
  });
  finalizeReconnectReplayBatch({
    normalizedDpId,
    maxAppliedSeq,
    markReconnectSequenceApplied,
    scrollBottom,
  });
  return true;
}
