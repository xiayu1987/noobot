/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { promoteSessionIdentityToBackendId } from "../../infra/sessionIdentity";
import { findReconnectDoneEnvelopeWithMessages } from "../../infra/reconnectReplayModel";
import { sanitizeExecutionLogForDisplay } from "../chatEngine/utils";
import { _trimStr } from "./utils";
import {
  findLatestAssistantMessageForRealtimeLogs,
  mergeRealtimeLogs,
} from "./messageLookup";

export function applyDoneMessagesFromReconnect({
  activeSession,
  activeSessionId,
  eventData = {},
  makeViewMessage,
  foldMessagesForView,
  applyCompletedToolLogsToMessages,
  sessionTitleFromMessages,
  applyFoldedMessagesForDialogProcess,
  applyFoldedMessagesToActiveSession,
} = {}) {
  if (!activeSession?.value) return false;
  const sessionMessages = Array.isArray(eventData?.messages) ? eventData.messages : [];
  if (!sessionMessages.length) return false;
  const returnedSessionId = _trimStr(eventData?.sessionId);
  if (returnedSessionId) {
    const promotionResult = promoteSessionIdentityToBackendId({
      sessionItem: activeSession.value,
      backendSessionId: returnedSessionId,
      activeSessionId: activeSessionId.value,
    });
    activeSessionId.value = promotionResult.nextActiveSessionId;
  }
  activeSession.value.loaded = true;
  activeSession.value.rawMessages = sessionMessages.map((messageItem) =>
    makeViewMessage(messageItem),
  );
  const foldedSessionMessages = foldMessagesForView(sessionMessages);
  const doneDialogProcessId = _trimStr(eventData?.dialogProcessId);
  if (
    doneDialogProcessId &&
    Array.isArray(activeSession.value.messages) &&
    activeSession.value.messages.length
  ) {
    applyFoldedMessagesForDialogProcess(activeSession, foldedSessionMessages, doneDialogProcessId);
  } else {
    applyFoldedMessagesToActiveSession(activeSession, foldedSessionMessages);
  }
  applyCompletedToolLogsToMessages(
    activeSession.value.messages,
    activeSession.value.sessionDocs || [],
  );
  activeSession.value.messageCount = activeSession.value.messages.length;
  activeSession.value.lastMessage = activeSession.value.messages.length
    ? activeSession.value.messages[activeSession.value.messages.length - 1]
    : null;
  activeSession.value.title = sessionTitleFromMessages(
    activeSession.value.messages,
    activeSession.value.title || returnedSessionId.slice(0, 8),
  );
  activeSession.value.updatedAt = new Date().toISOString();
  return true;
}

export function applyDoneRealtimeLogsFromReconnectBatch({
  activeSession,
  messages = [],
  normalizedDpId = "",
  classifyRealtimeLog,
  normalizeExecutionLogForRealtime,
} = {}) {
  const doneEnvelopeWithMessages = findReconnectDoneEnvelopeWithMessages(messages);
  if (!doneEnvelopeWithMessages) return false;
  const doneData = doneEnvelopeWithMessages.data || {};
  const executionSummarySteps = Array.isArray(doneData?.executionSummary?.steps)
    ? doneData.executionSummary.steps
    : [];
  const doneExecutionLogSource = executionSummarySteps.length
    ? executionSummarySteps
    : Array.isArray(doneData?.executionLogs)
      ? doneData.executionLogs
      : [];
  if (!doneExecutionLogSource.length) return true;
  const doneRealtimeLogs = doneExecutionLogSource
    .map((executionLogItem) =>
      classifyRealtimeLog(normalizeExecutionLogForRealtime(executionLogItem)),
    )
    .map((logItem) => sanitizeExecutionLogForDisplay(logItem))
    .filter((logItem) => logItem && _trimStr(logItem.text));
  if (!doneRealtimeLogs.length) return true;
  const targetMessage = findLatestAssistantMessageForRealtimeLogs({ activeSession, normalizedDpId });
  if (targetMessage) {
    targetMessage.executionLogTotal = Math.max(
      Number(targetMessage.executionLogTotal || 0),
      doneRealtimeLogs.length,
      Number(doneData?.executionSummary?.returned || 0),
      Number(doneData?.executionLogs?.length || 0),
    );
    mergeRealtimeLogs(targetMessage, doneRealtimeLogs);
  }
  return true;
}
