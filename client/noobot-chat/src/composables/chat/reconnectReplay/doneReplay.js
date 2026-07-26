/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { findVisibleLastMessage } from "../../infra/messageModel";
import {
  findReconnectDoneEnvelopeWithMessages,
  patchMessageObjectPreservingUiState,
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

function patchDoneAssistantByTurn({ activeSession, foldedSessionMessages = [], turnScopeId = "" } = {}) {
  const normalizedTurnScopeId = _trimStr(turnScopeId);
  if (!activeSession?.value || !normalizedTurnScopeId) {
    return { applied: false, reason: "missing_active_turn" };
  }
  const doneAssistant = [...foldedSessionMessages].reverse().find((messageItem) =>
    getMessageRole(messageItem) === RoleEnum.ASSISTANT &&
    getMessageTurnScopeId(messageItem) === normalizedTurnScopeId,
  );
  if (!doneAssistant) return { applied: false, reason: "done_assistant_missing" };
  const activeMessages = Array.isArray(activeSession.value.messages)
    ? activeSession.value.messages
    : [];
  let targetAssistant = activeMessages.find((messageItem) =>
    getMessageRole(messageItem) === RoleEnum.ASSISTANT &&
    getMessageTurnScopeId(messageItem) === normalizedTurnScopeId,
  );
  let inserted = false;
  if (!targetAssistant) {
    targetAssistant = doneAssistant;
    const lastTurnMessageIndex = activeMessages.findLastIndex(
      (messageItem) => getMessageTurnScopeId(messageItem) === normalizedTurnScopeId,
    );
    activeMessages.splice(lastTurnMessageIndex + 1, 0, targetAssistant);
    inserted = true;
  }
  // DONE is a versioned snapshot for this exact Turn. Reuse the canonical
  // message patch so a refreshed-page assistant placeholder can become the
  // finalized workflow/plugin message in place, without losing UI-owned state.
  patchMessageObjectPreservingUiState(targetAssistant, doneAssistant);
  const content = _trimStr(doneAssistant?.content);
  if (content) targetAssistant.content = content;
  targetAssistant.modelAlias = _trimStr(doneAssistant?.modelAlias) || targetAssistant.modelAlias;
  targetAssistant.modelName = _trimStr(doneAssistant?.modelName) || targetAssistant.modelName;
  if (Array.isArray(doneAssistant?.modelRuns)) targetAssistant.modelRuns = doneAssistant.modelRuns;
  targetAssistant.tool_calls = Array.isArray(doneAssistant?.tool_calls) ? doneAssistant.tool_calls : [];
  return { applied: true, inserted, targetAssistant };
}

export function applyDoneMessagesFromReconnect({
  activeSession,
  activeSessionId,
  eventData = {},
  makeViewMessage,
  foldMessagesForView,
  applyCompletedToolLogsToMessages,
  sessionTitleFromMessages,
  applyFoldedMessagesToActiveSession,
} = {}) {
  if (!activeSession?.value) return false;
  const sessionMessages = Array.isArray(eventData?.messages) ? eventData.messages : [];
  if (!sessionMessages.length) return false;
  const returnedSessionId = _trimStr(eventData?.sessionId);
  activeSession.value.loaded = true;
  // Reconnect DONE messages are a replay snapshot for reconciling the current
  // pending/streaming overlay.  Keep them local to this pass instead of
  // publishing another completed-message array on session.rawMessages; completed
  // display state is rebuilt from normalized session detail.
  const replayMessagesForView = sessionMessages.map((messageItem) =>
    makeViewMessage(messageItem),
  );
  const foldedSessionMessages = foldMessagesForView(replayMessagesForView);
  const doneTurnScopeId = _trimStr(eventData?.turnScopeId);
  let turnMergeResult = { applied: false, reason: "legacy_unscoped_done" };
  if (
    doneTurnScopeId &&
    Array.isArray(activeSession.value.messages) &&
    activeSession.value.messages.length
  ) {
    turnMergeResult = patchDoneAssistantByTurn({
      activeSession,
      foldedSessionMessages,
      turnScopeId: doneTurnScopeId,
    });
  } else if (!activeSession.value.messages.length) {
    // Unscoped legacy DONE is allowed to initialize an empty historical view,
    // but must never reconcile or fold a live turn by execution-chain identity.
    applyFoldedMessagesToActiveSession(activeSession, foldedSessionMessages);
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
  // A DONE snapshot belongs to a turn, not to its reusable execution chain.
  // Legacy snapshots without a turn are intentionally not projected into a
  // running assistant: session-detail hydration handles those at its isolated
  // history boundary.
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
