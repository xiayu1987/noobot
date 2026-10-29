/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../../chat/model/chatConstants.js";
import { findVisibleLastMessage } from "../../../chat/model/messageModel.js";
import {
  findSessionByAnyId as findSessionByAnyIdInList,
  confirmSessionIdentity,
} from "../../../chat/model/sessionIdentity.js";
import {
  getMessageDialogProcessId,
  getMessageRole,
  getMessageTurnScopeId,
} from "../../../chat/model/messageIdentity.js";
import { buildSessionDetailProjection } from "./sessionDetailProjection.js";
import { mergeCanonicalSessionDetail } from "../../../chat/model/sessionDetailMerge.js";
import { revokeMessagePreviewUrls } from "./sessionRecords.js";
import {
  logResendDebug,
  summarizeDebugMessages,
} from "../../../debug/loggers/resendDebugLogger.js";
import { logThinkingReplayDebug } from "../../../debug/loggers/thinkingReplayDebugLogger.js";
import { logWorkflowDiagnostics } from "../../../debug/loggers/workflowDiagnosticsLogger.js";
import { applyLatestSessionAggregateVersion } from "../../../chat/runtime/engine/sessionAggregateVersionManager.js";
import { isTurnRuntimeDeleted } from "../../../chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import {
  isAvailableSessionDetailEntry,
  requireSessionDetailDocument,
  selectMainSessionDetailEntry,
} from "@noobot/session-protocol/session-detail";
import { isPlainObject, requireFunctionDependencies } from "@noobot/shared/value";

export function createSessionDetailApplicator({
  sessions,
  turnRuntimeRegistry,
  chatStore,
  makeViewMessage,
  onSessionDetailApplied,
}) {
  if (!isPlainObject(chatStore)) {
    throw new TypeError("createSessionDetailApplicator requires chatStore");
  }
  requireFunctionDependencies("createSessionDetailApplicator", {
    applyTurnTimingSnapshot: chatStore.applyTurnTimingSnapshot,
    makeViewMessage,
    onSessionDetailApplied,
  });

  function pruneMessagesFromConfirmedDeletes(messages, sessionId) {
    const index = messages.findIndex((messageItem) =>
      isTurnRuntimeDeleted(turnRuntimeRegistry.value, {
        sessionId,
        turnScopeId: getMessageTurnScopeId(messageItem),
      }),
    );
    return index >= 0 ? messages.slice(0, index) : messages;
  }

  function summarizeToolProjection(messageItem) {
    return {
      role: getMessageRole(messageItem),
      pending: messageItem.pending === true,
      dialogProcessId: getMessageDialogProcessId(messageItem),
      turnScopeId: getMessageTurnScopeId(messageItem),
      toolTimelineCount: Array.isArray(messageItem.toolTimeline)
        ? messageItem.toolTimeline.length
        : 0,
      activityTimelineCount: Array.isArray(messageItem.activityTimeline)
        ? messageItem.activityTimeline.length
        : 0,
    };
  }

  function applyUnavailableEntry(sessionItem, mainEntry) {
    sessionItem.availability = mainEntry.availability;
    sessionItem.isUnavailable = true;
    sessionItem.unavailableReason = mainEntry.unavailableReason;
  }

  function applyAvailableEntry({ detail, sessionItem, mainEntry }) {
    const sessionId = detail.sessionId;
    sessionItem.turnLifecycleSnapshot = mainEntry.turnLifecycleSnapshot;
    applyLatestSessionAggregateVersion(sessionItem, mainEntry);
    sessionItem.createdAt = mainEntry.createdAt;
    sessionItem.updatedAt = mainEntry.updatedAt;

    const canonicalDetail = mergeCanonicalSessionDetail(
      { sessionId, messages: [] },
      { sessionId, messages: mainEntry.messages },
      { replaceFields: ["messages"] },
    );
    const detailMessages = pruneMessagesFromConfirmedDeletes(canonicalDetail.messages, sessionId);
    canonicalDetail.messages = detailMessages;
    sessionItem.detailMessages = detailMessages.map((item) => ({ ...item }));
    const detailProjection = buildSessionDetailProjection({
      sessionDetail: canonicalDetail,
      sessionDocs: detail.sessions,
      makeViewMessage,
    });
    chatStore.applyTurnTimingSnapshot({ sessionId, turnTimings: mainEntry.turnTimings });
    revokeMessagePreviewUrls(sessionItem.messages);

    const normalizedDetailMessages = detailProjection.messages;
    logThinkingReplayDebug("frontend.thinkingReplay.sessionDetailSnapshotReceived", () => ({
      sessionId,
      rawMessageCount: mainEntry.messages.length,
      normalizedMessageCount: normalizedDetailMessages.length,
      assistantMessages: normalizedDetailMessages
        .filter((item) => getMessageRole(item) === RoleEnum.ASSISTANT)
        .map(summarizeToolProjection),
    }));
    logResendDebug("detail.apply.replaceAll", () => ({
      sessionId,
      canonicalMessages: summarizeDebugMessages(detailMessages),
      presentationMessages: summarizeDebugMessages(normalizedDetailMessages),
      canonicalMessageCount: detailMessages.length,
      presentationMessageCount: normalizedDetailMessages.length,
    }));
    sessionItem.messages = normalizedDetailMessages;

    logThinkingReplayDebug("frontend.thinkingReplay.sessionDetailApplied", () => ({
      sessionId,
      renderedMessageCount: sessionItem.messages.length,
      assistantMessages: sessionItem.messages
        .filter((item) => getMessageRole(item) === RoleEnum.ASSISTANT)
        .map(summarizeToolProjection),
    }));
    onSessionDetailApplied({
      detail,
      sessionItem,
      mainSessionDoc: mainEntry,
      normalizedDetailMessages,
    });
    sessionItem.messageCount = sessionItem.messages.length;
    sessionItem.lastMessage = findVisibleLastMessage(sessionItem.messages);
    sessionItem.title = mainEntry.title;
  }

  function applySessionDetail(document) {
    const detail = requireSessionDetailDocument(document);
    const mainEntry = selectMainSessionDetailEntry(detail);
    const sessionItem = findSessionByAnyIdInList(sessions.value, detail.sessionId);
    if (!sessionItem) return;
    logResendDebug("detail.apply.begin", () => ({
      sessionId: detail.sessionId,
      currentMessages: summarizeDebugMessages(sessionItem.messages),
    }));
    sessionItem.loaded = true;
    confirmSessionIdentity({ sessionItem, sessionId: detail.sessionId });
    sessionItem.sessionDocs = detail.sessions;
    logWorkflowDiagnostics("frontend.workflowDetail.applySourceSelected", () => ({
      sessionId: detail.sessionId,
      availability: mainEntry.availability,
      sessionDocCount: detail.sessions.length,
    }));
    if (!isAvailableSessionDetailEntry(mainEntry)) {
      applyUnavailableEntry(sessionItem, mainEntry);
      return;
    }
    applyAvailableEntry({ detail, sessionItem, mainEntry });
  }

  return { applySessionDetail };
}
