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
import { getMessageDialogProcessId } from "../../infra/messageIdentity";
import { _ensureArray, _trimStr, normalizeReplayError } from "./utils";
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
import { logThinkingReplayDebug } from "../debug/thinkingReplayDebugLogger";
import { dispatchTurnEnvelope, TURN_PROJECTION_SOURCE } from "../chatEngine/turnProjectionStore";
import { buildToolTimelineFromLegacyLogs, mergeToolTimelines } from "../chatEngine/toolTimeline";
import { buildActivityTimelineFromLegacyLogs, mergeActivityTimelines } from "../chatEngine/activityTimeline";

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
  authoritativeCurrentRun = false,
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
    shouldCreateTarget: Boolean(allowCreate) && (
      !batchHasTerminalEvent || Boolean(authoritativeCurrentRun)
    ),
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
  legacyDialogFallback = false,
} = {}) {
  if (!legacyDialogFallback) return null;
  return createFinalAssistantFromReconnectReplay({
    activeSession,
    appendMessage,
    messages,
    dialogProcessId: normalizedDpId,
    legacyDialogFallback,
  });
}

export function resolveReconnectTargetOrApplyFallbackAssistant({
  activeSession,
  appendMessage,
  messages = [],
  normalizedDpId = "",
  turnScopeId = "",
  allowCreate = true,
  authoritativeCurrentRun = false,
  legacyDialogFallback = false,
} = {}) {
  const targetMessage = resolveReconnectTargetAssistantMessage({
    activeSession,
    appendMessage,
    dialogProcessId: normalizedDpId,
    turnScopeId,
    allowCreate,
    authoritativeCurrentRun,
  });
  if (targetMessage) {
    return { targetMessage, usedFallback: false };
  }
  const fallbackMessage = applyReconnectFallbackAssistant({
    activeSession,
    appendMessage,
    messages,
    normalizedDpId,
    legacyDialogFallback,
  });
  return { targetMessage: null, usedFallback: Boolean(fallbackMessage) };
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
  if (eventName === "message_event") {
    const messageEvent = eventData?.event;
    const reduction = dispatchTurnEnvelope({
      targetMessage,
      envelope: messageEvent,
      classifyRealtimeLog,
      source: TURN_PROJECTION_SOURCE.HISTORY_REPLAY,
    });
    logThinkingReplayDebug("frontend.messageEvent.reduced", {
      source: "history_replay",
      sessionId: String(messageEvent?.sessionId || eventData?.sessionId || ""),
      dialogProcessId: String(messageEvent?.dialogProcessId || eventData?.dialogProcessId || normalizedDpId),
      turnScopeId: String(messageEvent?.turnScopeId || eventData?.turnScopeId || ""),
      messageId: String(messageEvent?.messageId || ""),
      eventId: String(messageEvent?.eventId || ""),
      eventType: String(messageEvent?.eventType || ""),
      sequence: messageEvent?.sequence ?? envelope?.sequence ?? null,
      result: reduction.result,
      errors: reduction.errors || [],
    });
  } else if (eventName === StreamEventEnum.DELTA) {
    targetMessage.content += String(eventData?.text || "");
  } else if (eventName === StreamEventEnum.THINKING) {
    const logItem = sanitizeExecutionLogForDisplay(classifyRealtimeLog(eventData));
    logThinkingReplayDebug("frontend.thinkingReplay.reconnectThinkingClassified", {
      sessionId: String(eventData?.sessionId || targetMessage?.sessionId || ""),
      dialogProcessId: String(
        eventData?.dialogProcessId || getMessageDialogProcessId(targetMessage) || normalizedDpId,
      ),
      turnScopeId: String(eventData?.turnScopeId || targetMessage?.turnScopeId || ""),
      envelopeSequence: envelope?.sequence ?? null,
      dataSequence: eventData?.sequence ?? eventData?.seq ?? null,
      eventDataKeys: Object.keys(eventData || {}).sort(),
      logType: Array.isArray(eventData?.log) ? "array" : typeof eventData?.log,
      logEvent: String(eventData?.log?.event || eventData?.data?.log?.event || ""),
      logKeys: Object.keys(eventData?.log || {}).sort(),
      nestedDataKeys: Object.keys(eventData?.data || {}).sort(),
      nestedLogKeys: Object.keys(eventData?.data?.log || {}).sort(),
      classified: Boolean(logItem),
      classifiedType: String(logItem?.type || logItem?.event || ""),
      classifiedTextLength: String(logItem?.text || "").length,
      targetPending: targetMessage?.pending === true,
      targetRealtimeLogCount: Array.isArray(targetMessage?.realtimeLogs)
        ? targetMessage.realtimeLogs.length
        : 0,
    });
    if (!logItem || !_trimStr(logItem.text)) {
      const rawTextCandidates = {
        text: eventData?.text,
        output: eventData?.output,
        content: eventData?.content,
        message: eventData?.message,
        displayText: eventData?.displayText,
        nestedText: eventData?.data?.text,
        nestedOutput: eventData?.data?.output,
        nestedContent: eventData?.data?.content,
        nestedMessage: eventData?.data?.message,
        nestedDisplayText: eventData?.data?.displayText,
      };
      logThinkingReplayDebug("frontend.thinkingReplay.reconnectThinkingDropped", {
        sessionId: String(eventData?.sessionId || targetMessage?.sessionId || ""),
        dialogProcessId: String(
          eventData?.dialogProcessId || getMessageDialogProcessId(targetMessage) || normalizedDpId,
        ),
        turnScopeId: String(eventData?.turnScopeId || targetMessage?.turnScopeId || ""),
        sequence: eventData?.sequence ?? eventData?.seq ?? envelope?.sequence ?? null,
        eventDataKeys: Object.keys(eventData || {}).sort(),
        nestedDataKeys: Object.keys(eventData?.data || {}).sort(),
        rawTextCandidates: Object.fromEntries(
          Object.entries(rawTextCandidates).map(([key, value]) => {
            const text = typeof value === "string"
              ? value
              : value == null
                ? ""
                : JSON.stringify(value);
            return [key, { length: text.length, preview: text.slice(0, 500) }];
          }),
        ),
      });
      return true;
    }
    if (logItem?.dialogProcessId && !getMessageDialogProcessId(targetMessage)) {
      targetMessage.dialogProcessId = _trimStr(logItem.dialogProcessId);
    }
    targetMessage.toolTimeline = mergeToolTimelines(
      targetMessage.toolTimeline || [],
      buildToolTimelineFromLegacyLogs([logItem]),
    );
    targetMessage.activityTimeline = mergeActivityTimelines(
      targetMessage.activityTimeline || [],
      buildActivityTimelineFromLegacyLogs([logItem]),
    );
  } else if (eventName === StreamEventEnum.INTERACTION_REQUEST) {
    onInteractionRequest?.(eventData);
  } else if (eventName === StreamEventEnum.CONNECTOR_STATUS) {
    onConnectorStatus?.(eventData);
  } else if (eventName === StreamEventEnum.ATTACHMENTS) {
    onAttachments?.(targetMessage, eventData?.attachments || []);
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
        targetMessage.toolTimeline = mergeToolTimelines(
          targetMessage.toolTimeline || [],
          buildToolTimelineFromLegacyLogs(doneRealtimeLogs),
        );
        targetMessage.activityTimeline = mergeActivityTimelines(
          targetMessage.activityTimeline || [],
          buildActivityTimelineFromLegacyLogs(doneRealtimeLogs),
        );
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
    if (Array.isArray(eventData?.messages) && eventData.messages.length) {
      onDoneMessages?.(eventData);
    }
  } else if (eventName === StreamEventEnum.USER_STOPPED) {
    terminalDialogProcessIdSet?.add?.(normalizedDpId);
  } else if (eventName === StreamEventEnum.ERROR) {
    targetMessage.error = normalizeReplayError(eventData?.error) || normalizeReplayError(targetMessage?.error);
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
  sessionId = "",
  turnScopeId = "",
  maxAppliedSeq = 0,
  markReconnectSequenceApplied,
  navigateToLastMessage,
  shouldNavigate = false,
} = {}) {
  markReconnectSequenceApplied?.(normalizedDpId, maxAppliedSeq, { sessionId, turnScopeId });
  if (shouldNavigate) navigateToLastMessage?.();
}


export async function applyReconnectReplayBatchToActiveSession({
  activeSession,
  activeSessionId,
  appendMessage,
  chatList,
  messages = [],
  dialogProcessId = "",
  turnScopeId = "",
  allowCreate = true,
  authoritativeCurrentRun = false,
  legacyDialogFallback = false,
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
  const envelopeTurnScopeIds = new Set(
    _ensureArray(messages)
      .map(({ data } = {}) => _trimStr(data?.turnScopeId || data?.messageEvent?.turnScopeId))
      .filter(Boolean),
  );
  const normalizedTurnScopeId =
    _trimStr(turnScopeId) || (envelopeTurnScopeIds.size === 1 ? [...envelopeTurnScopeIds][0] : "");
  const {
    nextMessages,
    maxSequence,
    shouldSkipAfterTerminal,
    shouldCreateTarget,
  } = prepareReconnectReplayBatchPlan({
    messages,
    lastAppliedSeq,
    normalizedDpId,
    turnScopeId: normalizedTurnScopeId,
    terminalDialogProcessIdSet,
    isReconnectTerminalBatch,
    allowCreate,
    authoritativeCurrentRun,
  });
  logThinkingReplayDebug("frontend.thinkingReplay.reconnectBatchPlanned", {
    sessionId: _trimStr(activeSession.value?.backendSessionId || activeSession.value?.id),
    dialogProcessId: normalizedDpId,
    turnScopeId: normalizedTurnScopeId,
    inputCount: _ensureArray(messages).length,
    replayCount: nextMessages.length,
    filteredCount: Math.max(0, _ensureArray(messages).length - nextMessages.length),
    lastAppliedSeq: Number(lastAppliedSeq || 0),
    maxSequence,
    shouldSkipAfterTerminal,
    shouldCreateTarget,
  });
  if (!nextMessages.length) return false;
  if (shouldSkipAfterTerminal) {
    finalizeReconnectReplayBatch({
      normalizedDpId,
      sessionId: _trimStr(activeSession.value?.backendSessionId || activeSession.value?.id),
      turnScopeId: normalizedTurnScopeId,
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
    legacyDialogFallback,
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
      sessionId: _trimStr(activeSession.value?.backendSessionId || activeSession.value?.id),
      turnScopeId: normalizedTurnScopeId,
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
    turnScopeId: normalizedTurnScopeId,
    allowCreate: shouldCreateTarget,
    authoritativeCurrentRun,
  });
  if (usedFallback) {
    logThinkingReplayDebug("frontend.thinkingReplay.reconnectBatchFallback", {
      sessionId: _trimStr(activeSession.value?.backendSessionId || activeSession.value?.id),
      dialogProcessId: normalizedDpId,
      turnScopeId: normalizedTurnScopeId,
      replayCount: nextMessages.length,
      lastAppliedSeq: Number(lastAppliedSeq || 0),
      maxSequence,
    });
    finalizeReconnectReplayBatch({
      normalizedDpId,
      sessionId: _trimStr(activeSession.value?.backendSessionId || activeSession.value?.id),
      turnScopeId: normalizedTurnScopeId,
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
    sessionId: _trimStr(activeSession.value?.backendSessionId || activeSession.value?.id),
    turnScopeId: normalizedTurnScopeId,
    maxAppliedSeq,
    markReconnectSequenceApplied,
    navigateToLastMessage,
  });
  return true;
}
