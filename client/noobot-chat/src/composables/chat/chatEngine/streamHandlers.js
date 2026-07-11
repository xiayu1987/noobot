/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StreamEventEnum } from "../../../shared/constants/chatConstants";
import {
  ProcessEventSource,
} from "../../../shared/process/protocol";
import {
  createProcessEventFromLog,
  createProcessEventsFromDonePayload,
} from "../../../shared/process/aggregator";
import {
  getMessageDialogProcessId,
  getMessageTurnScopeId,
  normalizeTurnMeta,
} from "../../infra/messageIdentity";
import { promoteSessionIdentityToBackendId } from "../../infra/sessionIdentity";
import { applyDoneMessagesPatch } from "./messagePatch";
import {
  normalizeExecutionLogForRealtime,
  normalizeTrimmedString,
  sanitizeExecutionLogForDisplay,
  stripInternalEventPlaceholderLines,
} from "./utils";
import {
  normalizeInteractionRequestPayload,
  resolveConnectorStatusPayload,
} from "../interactionPayload";
import { BackendChannelState } from "../sessionRunStateMachine";
import { mergeAttachments } from "../../infra/dialogProcessChain";

function markFirstStreamEvent(botMessage) {
  if (!botMessage) return;
  botMessage.hasFirstStreamEvent = true;
}

function notifySendingStartedWhenDialogReady({ botMessage, locateSendingStartedMessageOnce }) {
  if (!getMessageDialogProcessId(botMessage)) return;
  locateSendingStartedMessageOnce?.();
}

function applyProcessCompatViewToMessage({ botMessage, processStore, processId }) {
  if (!botMessage || !processStore || !processId) return;
  const compatView = processStore.getCompatView?.(processId);
  if (!compatView || compatView.executionLogTotal <= 0) return;
  const executionLogTotal = Math.max(
    Number(compatView.executionLogTotal || 0),
    Number(botMessage.executionLogTotal || 0),
    Number(botMessage.processExecutionLogTotal || 0),
  );
  botMessage.processId = processId;
  botMessage.processLastSequence = compatView.lastSequence;
  if (getMessageTurnScopeId(botMessage)) {
    botMessage.processRealtimeLogs = compatView.realtimeLogs;
    botMessage.processCompletedToolLogs = compatView.completedToolLogs;
  }
  botMessage.processExecutionLogTotal = executionLogTotal;
}

function applyProcessEventsToMessage({ botMessage, processStore, events = [] }) {
  if (!botMessage || !processStore || !events.length) return;
  processStore.applyEventBatch?.(events);
  const processId = events[events.length - 1]?.processId || getMessageDialogProcessId(botMessage) || "";
  applyProcessCompatViewToMessage({ botMessage, processStore, processId });
}

export function handleThinkingStreamEvent({
  data,
  botMessage,
  classifyRealtimeLog,
  scrollOnFirstResponseOnce,
  processStore,
  locateSendingStartedMessageOnce,
}) {
  const item = sanitizeExecutionLogForDisplay(classifyRealtimeLog(data));
  if (!item || !normalizeTrimmedString(item.text)) {
    return;
  }
  if (!item.subAgentCall && item.dialogProcessId) {
    botMessage.dialogProcessId = item.dialogProcessId;
  }
  notifySendingStartedWhenDialogReady({ botMessage, locateSendingStartedMessageOnce });
  markFirstStreamEvent(botMessage);
  const previousExecutionLogTotal = Math.max(
    Number(botMessage.executionLogTotal || 0),
    Number(botMessage.processExecutionLogTotal || 0),
  );
  botMessage.executionLogTotal = previousExecutionLogTotal + 1;
  botMessage.realtimeLogs = [...(botMessage.realtimeLogs || []), item].slice(-10);
  const processEvent = createProcessEventFromLog(item, {
    source: ProcessEventSource.STREAM,
    sequence: data?.sequence ?? data?.seq ?? botMessage.executionLogTotal,
    dialogProcessId: item.dialogProcessId || data?.dialogProcessId || getMessageDialogProcessId(botMessage),
    sessionId: item.sessionId || data?.sessionId,
  });
  if (processEvent) {
    applyProcessEventsToMessage({ botMessage, processStore, events: [processEvent] });
  }
  scrollOnFirstResponseOnce();
}

export function handleDeltaStreamEvent({
  data,
  botMessage,
  scrollOnFirstResponseOnce,
  locateSendingStartedMessageOnce,
}) {
  const chunkText = stripInternalEventPlaceholderLines(data?.text || "");
  if (data?.dialogProcessId && !getMessageDialogProcessId(botMessage)) {
    botMessage.dialogProcessId = normalizeTrimmedString(data.dialogProcessId);
  }
  notifySendingStartedWhenDialogReady({ botMessage, locateSendingStartedMessageOnce });
  botMessage.content += chunkText;
  if (chunkText) {
    markFirstStreamEvent(botMessage);
    scrollOnFirstResponseOnce();
  }
}

export function handleConnectorStatusStreamEvent({
  data,
  activeSession,
  connectorTypeSet,
  upsertConnectedConnectorInPanelState,
  refreshSessionConnectorsAsync,
}) {
  const { connectorType, connectorName, status } = resolveConnectorStatusPayload(data);
  if (connectorTypeSet?.has?.(connectorType) && connectorName) {
    upsertConnectedConnectorInPanelState(activeSession.value, {
      connectorType,
      connectorName,
      status,
    });
    refreshSessionConnectorsAsync(activeSession.value?.id || "");
  }
}

export function handleAttachmentsStreamEvent({
  data,
  botMessage,
  mergeAssistantAttachments,
  scrollOnFirstResponseOnce,
}) {
  markFirstStreamEvent(botMessage);
  if (!getMessageTurnScopeId(botMessage)) return;
  mergeAssistantAttachments(botMessage, data?.attachments || []);
  scrollOnFirstResponseOnce();
}

export function handleAttachmentParsedStreamEvent({
  data,
  activeSession,
  makeViewMessage,
}) {
  const incoming = Array.isArray(data?.attachments) ? data.attachments : [];
  if (!incoming.length || !activeSession?.value) return;
  const normalized = typeof makeViewMessage === "function"
    ? makeViewMessage({ attachments: incoming })?.attachments || incoming
    : incoming;
  const messages = Array.isArray(activeSession.value.messages)
    ? activeSession.value.messages
    : [];
  for (const message of messages) {
    if (message?.role !== "user" || !Array.isArray(message?.attachments)) continue;
    message.attachments = message.attachments.map((existing) => {
      const matching = normalized.find((attachment) => {
        const attachmentId = normalizeTrimmedString(attachment?.attachmentId || attachment?.id);
        const existingAttachmentId = normalizeTrimmedString(existing?.attachmentId || existing?.id);
        const clientAttachmentId = normalizeTrimmedString(attachment?.clientAttachmentId);
        const existingClientAttachmentId = normalizeTrimmedString(existing?.clientAttachmentId);
        const contentSha256 = normalizeTrimmedString(attachment?.contentSha256);
        const existingContentSha256 = normalizeTrimmedString(existing?.contentSha256);
        return Boolean(
          (attachmentId && attachmentId === existingAttachmentId) ||
          (clientAttachmentId && clientAttachmentId === existingClientAttachmentId) ||
          (contentSha256 && contentSha256 === existingContentSha256)
        );
      });
      if (!matching) return existing;
      return {
        ...existing,
        ...(matching?.parsedResult ? { parsedResult: matching.parsedResult } : {}),
        ...(matching?.parsedResultUrl ? { parsedResultUrl: matching.parsedResultUrl } : {}),
        ...(matching?.parsedResultName ? { parsedResultName: matching.parsedResultName } : {}),
        ...(matching?.parsedResultAttachmentId
          ? { parsedResultAttachmentId: matching.parsedResultAttachmentId }
          : {}),
      };
    });
  }
}

export function handleInteractionRequestStreamEvent({
  data,
  clearMissingInteractionPayloadTimer,
  scrollOnFirstResponseOnce,
  tryAutoResolveInteraction,
  setPendingInteractionRequest,
}) {
  const normalizedInteractionRequest = normalizeInteractionRequestPayload({
    ...(data || {}),
    interactionType: normalizeTrimmedString(data?.interactionType),
  });
  clearMissingInteractionPayloadTimer({
    sessionId: normalizeTrimmedString(normalizedInteractionRequest?.sessionId),
    dialogProcessId: normalizeTrimmedString(normalizedInteractionRequest?.dialogProcessId),
  });
  scrollOnFirstResponseOnce();
  if (tryAutoResolveInteraction(normalizedInteractionRequest)) {
    return true;
  }
  setPendingInteractionRequest(normalizedInteractionRequest);
  return true;
}

export function handleDoneStreamEvent({
  data,
  requestedTextStreaming,
  botMessage,
  activeSession,
  activeSessionId,
  clearPendingInteraction,
  classifyRealtimeLog,
  scrollOnFirstResponseOnce,
  makeViewMessage,
  foldMessagesForView,
  mergeAssistantAttachments,
  locateDoneMessage,
  applyConversationState,
  processStore,
  locateSendingStartedMessageOnce,
  suppressCompletionConversationState,
}) {
  clearPendingInteraction();
  markFirstStreamEvent(botMessage);
  botMessage.dialogProcessId = data?.dialogProcessId || getMessageDialogProcessId(botMessage) || "";
  notifySendingStartedWhenDialogReady({ botMessage, locateSendingStartedMessageOnce });
  const executionSummarySteps = Array.isArray(data?.executionSummary?.steps)
    ? data.executionSummary.steps
    : [];
  const doneExecutionLogSource = executionSummarySteps.length
    ? executionSummarySteps
    : Array.isArray(data?.executionLogs)
      ? data.executionLogs
      : [];
  if (!requestedTextStreaming && doneExecutionLogSource.length) {
    const doneRealtimeLogs = doneExecutionLogSource
      .map((executionLogItem) =>
        classifyRealtimeLog(normalizeExecutionLogForRealtime(executionLogItem)),
      )
      .map((item) => sanitizeExecutionLogForDisplay(item))
      .filter((item) => item && normalizeTrimmedString(item.text));
    if (doneRealtimeLogs.length) {
      botMessage.realtimeLogs = [...(botMessage.realtimeLogs || []), ...doneRealtimeLogs].slice(-10);
      botMessage.executionLogTotal = Math.max(
        Number(botMessage.executionLogTotal || 0),
        doneRealtimeLogs.length,
        Number(data?.executionSummary?.returned || 0),
        Number(data?.executionLogs?.length || 0),
      );
      if (!getMessageDialogProcessId(botMessage)) {
        const latestDialogProcessId = [...doneRealtimeLogs]
          .reverse()
          .map((logItem) => normalizeTrimmedString(logItem?.dialogProcessId))
          .find(Boolean);
        if (latestDialogProcessId) {
          botMessage.dialogProcessId = latestDialogProcessId;
          notifySendingStartedWhenDialogReady({ botMessage, locateSendingStartedMessageOnce });
        }
      }
      const processEvents = createProcessEventsFromDonePayload(data, {
        source: ProcessEventSource.STREAM,
      });
      applyProcessEventsToMessage({ botMessage, processStore, events: processEvents });
      scrollOnFirstResponseOnce();
    }
  }
  const returnedId = data?.sessionId || activeSession.value.backendSessionId;
  if (returnedId) {
    activeSession.value.loaded = true;
    const promotionResult = promoteSessionIdentityToBackendId({
      sessionItem: activeSession.value,
      backendSessionId: returnedId,
      activeSessionId: activeSessionId.value,
    });
    activeSessionId.value = promotionResult.nextActiveSessionId;
  }
  applyDoneMessagesPatch({
    data,
    botMessage,
    activeSession,
    makeViewMessage,
    foldMessagesForView,
    mergeAssistantAttachments,
  });
  if (!suppressCompletionConversationState && botMessage?.pending !== false) {
    const turnMeta = normalizeTurnMeta(data);
    applyConversationState?.(
      {
        state: BackendChannelState.COMPLETED,
        sessionId: String(data?.sessionId || activeSession?.value?.backendSessionId || activeSession?.value?.id || ""),
        dialogProcessId: String(getMessageDialogProcessId(botMessage) || data?.dialogProcessId || ""),
        turnScopeId: String(getMessageTurnScopeId(botMessage) || turnMeta.turnScopeId || ""),
        sourceEvent: "done",
        updatedAtMs: nowMs(),
      },
      { botMessage },
    );
  }
}

export function handleBasicStreamEvent(event, context = {}) {
  if (event === StreamEventEnum.THINKING) {
    handleThinkingStreamEvent(context);
    return true;
  }
  if (event === StreamEventEnum.DELTA) {
    handleDeltaStreamEvent(context);
    return true;
  }
  if (event === StreamEventEnum.CONNECTOR_STATUS) {
    handleConnectorStatusStreamEvent(context);
    return true;
  }
  if (event === StreamEventEnum.ATTACHMENTS) {
    handleAttachmentsStreamEvent(context);
    return true;
  }
  if (event === StreamEventEnum.ATTACHMENT_PARSED) {
    handleAttachmentParsedStreamEvent(context);
    return true;
  }
  return false;
}
