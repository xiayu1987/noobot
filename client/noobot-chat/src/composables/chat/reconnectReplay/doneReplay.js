/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { findVisibleLastMessage } from "../../infra/messageModel";
import {
  findReconnectDoneEnvelopeWithMessages,
} from "../../infra/reconnectReplayModel";
import { nowIso } from "../../infra/timeFields";
import { sanitizeExecutionLogForDisplay } from "../chatEngine/utils";
import {
  buildToolTimelineFromLegacyLogs,
  fillMissingToolTimelineFacets,
  TOOL_SEQUENCE_DOMAIN,
  TOOL_TIMELINE_AUTHORITY,
} from "../chatEngine/toolTimeline";
import { _trimStr } from "./utils";
import { getMessageDialogProcessId, getMessageRole, getMessageTurnScopeId } from "../../infra/messageIdentity";
import { RoleEnum } from "../../../shared/constants/chatConstants";
import {
  logWorkflowDiagnostics,
  summarizeWorkflowMessage,
} from "../debug/workflowDiagnosticsLogger";
import { reconcileDoneTurnSnapshot } from "../chatEngine/messagePatch";

export function applyDoneMessagesFromReconnect({
  activeSession,
  activeSessionId,
  eventData = {},
  makeViewMessage,
  foldMessagesForView,
  applyCompletedToolLogsToMessages,
  sessionTitleFromMessages,
  applyFoldedMessagesToActiveSession,
  mergeAssistantAttachments,
} = {}) {
  if (!activeSession?.value) return false;
  const sessionMessages = Array.isArray(eventData?.messages) ? eventData.messages : [];
  if (!sessionMessages.length) return false;
  const returnedSessionId = _trimStr(eventData?.sessionId);
  activeSession.value.loaded = true;
  const doneTurnScopeId = _trimStr(eventData?.turnScopeId);
  let turnMergeResult = { applied: false, reason: "legacy_unscoped_done" };
  if (
    doneTurnScopeId &&
    Array.isArray(activeSession.value.messages) &&
    activeSession.value.messages.length
  ) {
    turnMergeResult = reconcileDoneTurnSnapshot({
      data: eventData,
      activeSession,
      makeViewMessage,
      foldMessagesForView,
      mergeAssistantAttachments,
    });
  } else if (!activeSession.value.messages.length) {
    const replayMessagesForView = sessionMessages.map((messageItem) => makeViewMessage(messageItem));
    applyFoldedMessagesToActiveSession(activeSession, foldMessagesForView(replayMessagesForView));
  }
  logWorkflowDiagnostics("frontend.workflowReplay.doneMessagesReconciled", {
    sessionId: returnedSessionId || _trimStr(activeSession.value?.backendSessionId || activeSessionId?.value),
    dialogProcessId: _trimStr(eventData?.dialogProcessId),
    turnScopeId: doneTurnScopeId,
    result: turnMergeResult?.applied === true ? "applied" : "ignored",
    reason: _trimStr(turnMergeResult?.reason),
    insertedAssistant: turnMergeResult?.inserted === true,
    doneMessageCount: sessionMessages.length,
    activeMessageCount: activeSession.value.messages.length,
    assistant: turnMergeResult?.targetAssistant
      ? summarizeWorkflowMessage(turnMergeResult.targetAssistant)
      : null,
  });
  applyCompletedToolLogsToMessages(
    activeSession.value.messages,
    activeSession.value.sessionDocs || [],
  );
  activeSession.value.messageCount = activeSession.value.messages.length;
  activeSession.value.lastMessage = findVisibleLastMessage(activeSession.value.messages);
  activeSession.value.title = sessionTitleFromMessages(
    activeSession.value.messages,
    activeSession.value.title || returnedSessionId.slice(0, 8),
  );
  activeSession.value.updatedAt = nowIso();
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
  const turnScopeId = _trimStr(doneData?.turnScopeId);
  if (!turnScopeId) return true;
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
    .filter((logItem) => logItem && _trimStr(logItem.text))
    .map((logItem) => ({
      ...logItem,
      authority: TOOL_TIMELINE_AUTHORITY.COMPATIBILITY,
      sequenceDomain: TOOL_SEQUENCE_DOMAIN.TRANSPORT,
    }));
  if (!doneRealtimeLogs.length) return true;
  const targetMessage = [...(activeSession?.value?.messages || [])].reverse().find(
    (messageItem) =>
      getMessageRole(messageItem) === RoleEnum.ASSISTANT &&
      getMessageTurnScopeId(messageItem) === turnScopeId,
  );
  if (targetMessage) {
    targetMessage.toolTimeline = fillMissingToolTimelineFacets(
      targetMessage.toolTimeline,
      buildToolTimelineFromLegacyLogs(doneRealtimeLogs, {
        sequenceDomain: TOOL_SEQUENCE_DOMAIN.TRANSPORT,
      }),
    );
  }
  return true;
}
