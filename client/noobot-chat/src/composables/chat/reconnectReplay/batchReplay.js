/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum, StreamEventEnum } from "../../../shared/constants/chatConstants";
import {
  createProcessEventFromLog,
  createProcessEventsFromDonePayload,
} from "../../../shared/process/aggregator";
import {
  PROCESS_COMPAT_LOG_LIMIT,
  ProcessEventSource,
} from "../../../shared/process/protocol";
import { sanitizeExecutionLogForDisplay } from "../chatEngine/utils";
import {
  findReconnectDoneEnvelopeWithMessages,
  getReconnectEnvelopeSequence,
  getReconnectMaxSequence,
  isPendingInteractionReplay,
} from "../../infra/reconnectReplayModel";
import { getMessageDialogProcessId } from "../../infra/messageIdentity";
import { getThinkingFinishedAt, nowIso, setThinkingFinishedAt } from "../../infra/timeFields";
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

function resolveReconnectProcessId({ targetMessage, normalizedDpId = "", logItem = null, eventData = null } = {}) {
  return _trimStr(logItem?.processId) ||
    _trimStr(logItem?.dialogProcessId) ||
    _trimStr(eventData?.processId) ||
    _trimStr(eventData?.dialogProcessId) ||
    _trimStr(normalizedDpId) ||
    _trimStr(targetMessage?.processId) ||
    getMessageDialogProcessId(targetMessage);
}

function getProcessLogMergeKey(logItem = {}) {
  const explicitKey = _trimStr(
    logItem.eventId ||
      logItem.id ||
      logItem.nodeId ||
      logItem.toolCallId ||
      logItem.tool_call_id,
  );
  if (explicitKey) return `id:${explicitKey}`;
  const sequence = Number(logItem.sequence ?? logItem.seq);
  const processId = _trimStr(logItem.processId || logItem.dialogProcessId);
  if (Number.isFinite(sequence) && sequence > 0) {
    return `seq:${processId}:${sequence}`;
  }
  try {
    return `json:${JSON.stringify({
      event: logItem.event,
      type: logItem.type,
      text: logItem.text,
      displayText: logItem.displayText,
      ts: logItem.ts,
      timestamp: logItem.timestamp,
      processId,
    })}`;
  } catch {
    return "";
  }
}

function mergeProcessCompatLogs(existingLogs = [], nextLogs = [], { limit = 0 } = {}) {
  const mergedLogs = [];
  const seenKeys = new Set();
  for (const logItem of [
    ...(Array.isArray(existingLogs) ? existingLogs : []),
    ...(Array.isArray(nextLogs) ? nextLogs : []),
  ]) {
    if (!logItem) continue;
    const mergeKey = getProcessLogMergeKey(logItem);
    if (mergeKey && seenKeys.has(mergeKey)) continue;
    if (mergeKey) seenKeys.add(mergeKey);
    mergedLogs.push(logItem);
  }
  return limit > 0 ? mergedLogs.slice(-limit) : mergedLogs;
}

function applyProcessCompatViewToReconnectMessage({ targetMessage, processStore, processId = "" } = {}) {
  if (!targetMessage || !processStore || !_trimStr(processId)) return;
  const compatView = processStore.getCompatView?.(processId);
  if (!compatView) return;
  targetMessage.processId = processId;
  targetMessage.processLastSequence = compatView.lastSequence;
  targetMessage.processRealtimeLogs = mergeProcessCompatLogs(
    targetMessage.processRealtimeLogs,
    compatView.realtimeLogs,
    { limit: PROCESS_COMPAT_LOG_LIMIT },
  );
  targetMessage.processCompletedToolLogs = mergeProcessCompatLogs(
    targetMessage.processCompletedToolLogs,
    compatView.completedToolLogs,
  );
  targetMessage.processExecutionLogTotal = Math.max(
    Number(compatView.executionLogTotal || 0),
    Number(targetMessage.executionLogTotal || 0),
    Number(targetMessage.processExecutionLogTotal || 0),
  );
}

function applyReconnectProcessEvents({ processStore, processId = "", events = [], targetMessage } = {}) {
  if (!processStore || !_trimStr(processId) || !events.length) return;
  if (typeof processStore.applyEventBatch === "function") {
    processStore.applyEventBatch(events);
  } else {
    events.forEach((event) => processStore.applyEvent?.(event));
  }
  applyProcessCompatViewToReconnectMessage({ targetMessage, processStore, processId });
}

function applyReconnectThinkingProcessEvent({
  eventData = {},
  logItem,
  targetMessage,
  normalizedDpId = "",
  processStore,
} = {}) {
  const processId = resolveReconnectProcessId({ targetMessage, normalizedDpId, logItem, eventData });
  if (!_trimStr(processId)) return;
  const sequence = Number(eventData?.sequence ?? eventData?.seq ?? targetMessage?.executionLogTotal ?? 0);
  const processEvent = createProcessEventFromLog(logItem, {
    processId,
    source: ProcessEventSource.STREAM,
    sequence,
    fallbackSequence: Number(targetMessage?.executionLogTotal || 0),
  });
  applyReconnectProcessEvents({
    processStore,
    processId,
    events: processEvent ? [processEvent] : [],
    targetMessage,
  });
}

function applyReconnectDoneProcessEvents({
  eventData = {},
  targetMessage,
  normalizedDpId = "",
  processStore,
} = {}) {
  const processId = resolveReconnectProcessId({ targetMessage, normalizedDpId, eventData });
  if (!_trimStr(processId)) return;
  const baseSequence = Number(
    eventData?.sequence ??
      eventData?.seq ??
      targetMessage?.processLastSequence ??
      targetMessage?.executionLogTotal ??
      0,
  );
  const processEvents = createProcessEventsFromDonePayload(eventData, {
    processId,
    source: ProcessEventSource.STREAM,
    baseSequence,
  });
  applyReconnectProcessEvents({
    processStore,
    processId,
    events: processEvents,
    targetMessage,
  });
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
  onAttachments,
  onDoneMessages,
  processStore,
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
    if (logItem?.dialogProcessId && !getMessageDialogProcessId(targetMessage)) {
      targetMessage.dialogProcessId = _trimStr(logItem.dialogProcessId);
    }
    const previousExecutionLogTotal = Math.max(
      Number(targetMessage.executionLogTotal || 0),
      Number(targetMessage.processExecutionLogTotal || 0),
    );
    targetMessage.executionLogTotal = previousExecutionLogTotal + 1;
    mergeRealtimeLogs(targetMessage, [logItem]);
    applyReconnectThinkingProcessEvent({
      eventData,
      logItem,
      targetMessage,
      normalizedDpId,
      processStore,
    });
  } else if (eventName === StreamEventEnum.INTERACTION_REQUEST) {
    onInteractionRequest?.(eventData);
  } else if (eventName === StreamEventEnum.CONNECTOR_STATUS) {
    onConnectorStatus?.(eventData);
  } else if (eventName === StreamEventEnum.ATTACHMENTS) {
    onAttachments?.(targetMessage, eventData?.attachments || []);
  } else if (eventName === StreamEventEnum.DONE) {
    terminalDialogProcessIdSet?.add?.(normalizedDpId);
    targetMessage.pending = false;
    targetMessage.statusLabel = "chat.generated";
    setThinkingFinishedAt(targetMessage, getThinkingFinishedAt(targetMessage) || nowIso());
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
        if (!getMessageDialogProcessId(targetMessage)) {
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
    applyReconnectDoneProcessEvents({
      eventData,
      targetMessage,
      normalizedDpId,
      processStore,
    });
    if (Array.isArray(eventData?.messages) && eventData.messages.length) {
      onDoneMessages?.(eventData);
    }
  } else if (eventName === StreamEventEnum.USER_STOPPED) {
    terminalDialogProcessIdSet?.add?.(normalizedDpId);
  } else if (eventName === StreamEventEnum.ERROR) {
    targetMessage.error = String(eventData?.error || targetMessage?.error || "");
    applyReconnectDoneProcessEvents({
      eventData,
      targetMessage,
      normalizedDpId,
      processStore,
    });
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
  onAttachments,
  onDoneMessages,
  processStore,
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
      onAttachments,
      onDoneMessages,
      processStore,
    });
  }
  return maxAppliedSeq;
}

export function buildReconnectReplayEnvelopeCallbacks({
  onInteractionRequest,
  onConnectorStatus,
  onAttachments,
  onDoneMessages,
} = {}) {
  return {
    onInteractionRequest: (eventData) => onInteractionRequest?.(eventData),
    onConnectorStatus: (eventData) => onConnectorStatus?.(eventData),
    onAttachments: (targetMessage, attachments = []) =>
      onAttachments?.(targetMessage, attachments),
    onDoneMessages: (eventData) => onDoneMessages?.(eventData),
  };
}

export function finalizeReconnectReplayBatch({
  normalizedDpId = "",
  maxAppliedSeq = 0,
  markReconnectSequenceApplied,
  navigateToLastMessage,
  shouldNavigate = false,
} = {}) {
  markReconnectSequenceApplied?.(normalizedDpId, maxAppliedSeq);
  if (shouldNavigate) navigateToLastMessage?.();
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
  onHydrationError = () => {},
  applyDoneMessages,
  envelopeCallbacks = {},
  markReconnectSequenceApplied,
  navigateToLastMessage,
  processStore,
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
      navigateToLastMessage,
      shouldNavigate: false,
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
      navigateToLastMessage,
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
      navigateToLastMessage,
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
    processStore,
  });
  finalizeReconnectReplayBatch({
    normalizedDpId,
    maxAppliedSeq,
    markReconnectSequenceApplied,
    navigateToLastMessage,
  });
  return true;
}
