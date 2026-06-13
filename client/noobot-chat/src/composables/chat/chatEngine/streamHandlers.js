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
} from "./utils";
import {
  normalizeInteractionRequestPayload,
  resolveConnectorStatusPayload,
} from "../interactionPayload";

export function handleThinkingStreamEvent({
  data,
  botMessage,
  classifyRealtimeLog,
  scrollOnFirstResponseOnce,
}) {
  const item = classifyRealtimeLog(data);
  if (!item.subAgentCall && item.dialogProcessId) {
    botMessage.dialogProcessId = item.dialogProcessId;
  }
  botMessage.executionLogTotal = Number(botMessage.executionLogTotal || 0) + 1;
  botMessage.realtimeLogs = [...(botMessage.realtimeLogs || []), item].slice(-10);
  scrollOnFirstResponseOnce();
}

export function handleDeltaStreamEvent({ data, botMessage, scrollOnFirstResponseOnce }) {
  const chunkText = String(data?.text || "");
  if (data?.dialogProcessId && !normalizeTrimmedString(botMessage.dialogProcessId)) {
    botMessage.dialogProcessId = normalizeTrimmedString(data.dialogProcessId);
  }
  botMessage.content += chunkText;
  if (chunkText) {
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
  scrollBottom,
}) {
  clearPendingInteraction();
  botMessage.dialogProcessId = data?.dialogProcessId || botMessage.dialogProcessId || "";
  if (!requestedTextStreaming && Array.isArray(data?.executionLogs)) {
    const doneRealtimeLogs = data.executionLogs
      .map((executionLogItem) =>
        classifyRealtimeLog(normalizeExecutionLogForRealtime(executionLogItem)),
      )
      .filter(Boolean);
    if (doneRealtimeLogs.length) {
      botMessage.realtimeLogs = [...(botMessage.realtimeLogs || []), ...doneRealtimeLogs].slice(
        -10,
      );
      botMessage.executionLogTotal = Math.max(
        Number(botMessage.executionLogTotal || 0),
        doneRealtimeLogs.length,
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
  scrollBottom();
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
