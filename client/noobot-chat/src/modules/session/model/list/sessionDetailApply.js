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
import {
  isAvailableSessionDetailEntry,
  isSessionDetailEntryCurrent,
  requireSessionDetailDocument,
  selectMainSessionDetailEntry,
  selectSessionDetailBlockingEntry,
} from "@noobot/session-protocol/session-detail";
import { isPlainObject, requireFunctionDependencies } from "@noobot/shared/value";

export function createSessionDetailApplicator({
  sessions,
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

  function applyUnavailableEntry(sessionItem, blockingEntry) {
    revokeMessagePreviewUrls(sessionItem.messages);
    delete sessionItem.lastMessage;
    delete sessionItem.turnLifecycleSnapshot;
    Object.assign(sessionItem, {
      detailUnavailableReason: blockingEntry.unavailableReason,
      sessionDocs: [],
      detailMessages: [],
      messages: [],
      loaded: false,
    });
  }

  function applyAvailableEntry({ detail, sessionItem, mainEntry }) {
    const sessionId = detail.sessionId;
    const canonicalDetail = mergeCanonicalSessionDetail(
      { sessionId, messages: [] },
      { sessionId, messages: mainEntry.messages },
      { replaceFields: ["messages"] },
    );
    const detailMessages = canonicalDetail.messages;
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
    const lastMessage = findVisibleLastMessage(normalizedDetailMessages);
    confirmSessionIdentity({ sessionItem, sessionId });
    applyLatestSessionAggregateVersion(sessionItem, mainEntry);
    delete sessionItem.detailUnavailableReason;
    Object.assign(sessionItem, {
      knownGeneration: mainEntry.generation,
      turnLifecycleSnapshot: mainEntry.turnLifecycleSnapshot,
      createdAt: mainEntry.createdAt,
      updatedAt: mainEntry.updatedAt,
      detailMessages: detailMessages.map((item) => ({ ...item })),
      messages: normalizedDetailMessages,
      messageCount: mainEntry.stats.messageCount,
      lastMessage,
      title: mainEntry.title,
      sessionDocs: detail.sessions,
      loaded: true,
    });

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
  }

  function applySessionDetail(document) {
    const detail = requireSessionDetailDocument(document);
    const mainEntry = selectMainSessionDetailEntry(detail);
    const sessionItem = findSessionByAnyIdInList(sessions.value, detail.sessionId);
    if (!sessionItem || sessionItem.isUnavailable) return false;
    if (
      isAvailableSessionDetailEntry(mainEntry) &&
      !isSessionDetailEntryCurrent(mainEntry, sessionItem)
    )
      return false;
    logResendDebug("detail.apply.begin", () => ({
      sessionId: detail.sessionId,
      currentMessages: summarizeDebugMessages(sessionItem.messages),
    }));
    const blockingEntry = selectSessionDetailBlockingEntry(detail);
    logWorkflowDiagnostics("frontend.workflowDetail.applySourceSelected", () => ({
      sessionId: detail.sessionId,
      blockingSessionId: blockingEntry?.sessionId ?? null,
      sessionDocCount: detail.sessions.length,
    }));
    if (blockingEntry !== null) {
      confirmSessionIdentity({ sessionItem, sessionId: detail.sessionId });
      applyUnavailableEntry(sessionItem, blockingEntry);
      return false;
    }
    applyAvailableEntry({ detail, sessionItem, mainEntry });
    return true;
  }

  return { applySessionDetail };
}
