/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StreamEventEnum } from "../../../shared/constants/chatConstants";
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

function markFirstStreamEvent(botMessage) {
  if (!botMessage) return;
  botMessage.hasFirstStreamEvent = true;
}

export function handleThinkingStreamEvent({
  data,
  botMessage,
  classifyRealtimeLog,
  scrollOnFirstResponseOnce,
}) {
  const item = sanitizeExecutionLogForDisplay(classifyRealtimeLog(data));
  if (!item || !normalizeTrimmedString(item.text)) {
    return;
  }
  if (!item.subAgentCall && item.dialogProcessId) {
    botMessage.dialogProcessId = item.dialogProcessId;
  }
  markFirstStreamEvent(botMessage);
  botMessage.executionLogTotal = Number(botMessage.executionLogTotal || 0) + 1;
  botMessage.realtimeLogs = [...(botMessage.realtimeLogs || []), item].slice(-10);
  scrollOnFirstResponseOnce();
}

export function handleDeltaStreamEvent({ data, botMessage, scrollOnFirstResponseOnce }) {
  const chunkText = stripInternalEventPlaceholderLines(data?.text || "");
  if (data?.dialogProcessId && !normalizeTrimmedString(botMessage.dialogProcessId)) {
    botMessage.dialogProcessId = normalizeTrimmedString(data.dialogProcessId);
  }
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

export function handleAttachmentMetasStreamEvent({
  data,
  botMessage,
  mergeAssistantAttachmentMetas,
  scrollOnFirstResponseOnce,
}) {
  markFirstStreamEvent(botMessage);
  mergeAssistantAttachmentMetas(botMessage, data?.attachmentMetas || []);
  scrollOnFirstResponseOnce();
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
  mergeAssistantAttachmentMetas,
  locateDoneMessage,
}) {
  clearPendingInteraction();
  markFirstStreamEvent(botMessage);
  botMessage.dialogProcessId = data?.dialogProcessId || botMessage.dialogProcessId || "";
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
      if (!normalizeTrimmedString(botMessage.dialogProcessId)) {
        const latestDialogProcessId = [...doneRealtimeLogs]
          .reverse()
          .map((logItem) => normalizeTrimmedString(logItem?.dialogProcessId))
          .find(Boolean);
        if (latestDialogProcessId) {
          botMessage.dialogProcessId = latestDialogProcessId;
        }
      }
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
    mergeAssistantAttachmentMetas,
  });
  locateDoneMessage?.();
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
  if (event === StreamEventEnum.ATTACHMENT_METAS) {
    handleAttachmentMetasStreamEvent(context);
    return true;
  }
  return false;
}
