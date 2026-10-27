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
import {
  logWorkflowDiagnostics,
  summarizeWorkflowMessages,
} from "../../../debug/loggers/workflowDiagnosticsLogger.js";
import { applyLatestSessionAggregateVersion } from "../../../chat/runtime/engine/sessionAggregateVersionManager.js";
import { isTurnRuntimeDeleted } from "../../../chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { isPlainObject, requireFunctionDependencies, text } from "@noobot/shared/value";

function requireAvailableTurnTimings(sessionDoc) {
  if (sessionDoc.availability === "unavailable") return null;
  if (!Array.isArray(sessionDoc.turnTimings)) {
    throw new TypeError(
      `[session-detail] available session doc ${text(sessionDoc.sessionId)} requires turnTimings array`,
    );
  }
  return sessionDoc.turnTimings;
}

export function createSessionDetailApplicator({
  sessions,
  turnRuntimeRegistry,
  chatStore,
  makeViewMessage,
  sessionTitleFromMessages,
  navigateToLastMessage,
  onSessionDetailApplied,
}) {
  if (!isPlainObject(chatStore)) {
    throw new TypeError("createSessionDetailApplicator requires chatStore");
  }
  requireFunctionDependencies("createSessionDetailApplicator", {
    applyTurnTimingSnapshot: chatStore.applyTurnTimingSnapshot,
    makeViewMessage,
    sessionTitleFromMessages,
    navigateToLastMessage,
    onSessionDetailApplied,
  });
  function pruneMessagesFromConfirmedDeletes(messages = [], sessionId = "") {
    const source = Array.isArray(messages) ? messages : [];
    const index = source.findIndex((messageItem) =>
      isTurnRuntimeDeleted(turnRuntimeRegistry.value, {
        sessionId,
        turnScopeId: getMessageTurnScopeId(messageItem),
      }),
    );
    return index >= 0 ? source.slice(0, index) : source;
  }

  function summarizeToolProjection(messageItem = {}) {
    return {
      role: getMessageRole(messageItem),
      pending: messageItem?.pending === true,
      dialogProcessId: getMessageDialogProcessId(messageItem),
      turnScopeId: getMessageTurnScopeId(messageItem),
      toolTimelineCount: Array.isArray(messageItem?.toolTimeline)
        ? messageItem.toolTimeline.length
        : 0,
      activityTimelineCount: Array.isArray(messageItem?.activityTimeline)
        ? messageItem.activityTimeline.length
        : 0,
    };
  }

  function applySessionDetail(detail, options = {}) {
    const sessionItem = findSessionByAnyIdInList(sessions.value, detail.sessionId);
    if (!sessionItem) return;
    logResendDebug("detail.apply.begin", () => ({
      sessionId: detail.sessionId,
      currentMessages: summarizeDebugMessages(sessionItem.messages),
    }));
    const detailSessionId = text(detail.sessionId);
    sessionItem.loaded = true;
    confirmSessionIdentity({
      sessionItem,
      sessionId: detailSessionId,
    });
    const sessionDocs = Array.isArray(detail.sessions) ? detail.sessions : [];
    sessionItem.sessionDocs = sessionDocs;
    const mainSessionDoc =
      sessionDocs.find((doc) => doc.sessionId === detail.sessionId) || sessionDocs[0] || {};
    logWorkflowDiagnostics("frontend.workflowDetail.applySourceSelected", () => ({
      sessionId: detailSessionId,
      selectedSessionDocId: String(mainSessionDoc?.sessionId || ""),
      sessionDocCount: sessionDocs.length,
      currentCandidates: summarizeWorkflowMessages(sessionItem.messages),
      persistedCandidates: summarizeWorkflowMessages(mainSessionDoc.messages),
    }));
    const serverSessionTitle = text(
      mainSessionDoc.title || mainSessionDoc.customTitle || detail.title,
    );
    const hasMessageSnapshot = Array.isArray(mainSessionDoc.messages);
    sessionItem.currentTaskId = mainSessionDoc.currentTaskId || "";

    const turnLifecycleSnapshot = mainSessionDoc?.turnLifecycleSnapshot;
    if (turnLifecycleSnapshot) {
      sessionItem.turnLifecycleSnapshot = turnLifecycleSnapshot;
    }
    applyLatestSessionAggregateVersion(sessionItem, mainSessionDoc);
    sessionItem.createdAt = mainSessionDoc.createdAt || sessionItem.createdAt;
    sessionItem.updatedAt = mainSessionDoc.updatedAt || sessionItem.updatedAt;

    const canonicalDetail = mergeCanonicalSessionDetail(
      {
        sessionId: detailSessionId,
        messages: sessionItem.detailMessages || [],
      },
      {
        sessionId: detailSessionId,
        messages: mainSessionDoc.messages,
      },
      { replaceFields: Array.isArray(mainSessionDoc.messages) ? ["messages"] : [] },
    );
    const detailMessages = pruneMessagesFromConfirmedDeletes(
      canonicalDetail.messages,
      detailSessionId,
    );
    if (detailMessages !== canonicalDetail.messages) {
      canonicalDetail.messages = detailMessages;
    }
    const turnTimings = requireAvailableTurnTimings(mainSessionDoc);
    if (hasMessageSnapshot) {
      sessionItem.detailMessages = detailMessages.map((item) => ({ ...item }));
    }
    const detailProjection = buildSessionDetailProjection({
      sessionDetail: canonicalDetail,
      sessionDocs,
      makeViewMessage,
    });
    if (turnTimings) {
      chatStore.applyTurnTimingSnapshot({ sessionId: detailSessionId, turnTimings });
    }
    logResendDebug("detail.apply.mode", () => ({
      sessionId: detail.sessionId,
      authority: "session_detail",
      hasMessageSnapshot,
      detailMessageCount: detailMessages.length,
      detailTurnScopeIds: [
        ...new Set(
          detailMessages.map((messageItem) => getMessageTurnScopeId(messageItem)).filter(Boolean),
        ),
      ],
    }));
    if (hasMessageSnapshot) revokeMessagePreviewUrls(sessionItem.messages || []);

    const normalizedDetailMessages = hasMessageSnapshot
      ? detailProjection.messages
      : sessionItem.messages;
    logThinkingReplayDebug("frontend.thinkingReplay.sessionDetailSnapshotReceived", () => ({
      sessionId: detail.sessionId,
      detailMode: String(detail?.detailMode || (detail?.summary === true ? "summary" : "")),
      rawMessageCount: Array.isArray(mainSessionDoc?.messages) ? mainSessionDoc.messages.length : 0,
      normalizedMessageCount: normalizedDetailMessages.length,
      assistantMessages: normalizedDetailMessages
        .filter((item) => getMessageRole(item) === RoleEnum.ASSISTANT)
        .map((item) => ({
          ...summarizeToolProjection(item),
          activityTimelineFacts: (item.activityTimeline || [])
            .slice(0, 64)
            .map((activity = {}) => ({
              eventId: String(activity.eventId || ""),
              eventType: String(activity.eventType || ""),
              activityKind: String(activity.activityKind || ""),
              sequence: Number(activity.sequence || 0),
              sequenceDomain: String(activity.sequenceDomain || ""),
              sequenceScopeId: String(activity.sequenceScopeId || ""),
              authority: String(activity.authority || ""),
            })),
        })),
    }));

    if (hasMessageSnapshot) {
      logResendDebug("detail.apply.replaceAll", () => ({
        sessionId: detail.sessionId,
        canonicalMessages: summarizeDebugMessages(detailMessages),
        presentationMessages: summarizeDebugMessages(normalizedDetailMessages),
        canonicalMessageCount: detailMessages.length,
        presentationMessageCount: normalizedDetailMessages.length,
      }));
      sessionItem.messages = normalizedDetailMessages;
    }

    logThinkingReplayDebug("frontend.thinkingReplay.sessionDetailApplied", () => ({
      sessionId: detail.sessionId,
      renderedMessageCount: sessionItem.messages.length,
      assistantMessages: sessionItem.messages
        .filter((item) => getMessageRole(item) === RoleEnum.ASSISTANT)
        .map(summarizeToolProjection),
    }));
    onSessionDetailApplied({
      detail,
      sessionItem,
      mainSessionDoc,
      normalizedDetailMessages,
    });
    sessionItem.messageCount = sessionItem.messages.length;
    sessionItem.lastMessage = findVisibleLastMessage(sessionItem.messages);

    sessionItem.title =
      serverSessionTitle ||
      sessionTitleFromMessages(
        sessionItem.messages,
        sessionItem.title || detail.sessionId.slice(0, 8),
      );
    if (options.navigateToLastMessage === true) navigateToLastMessage();
  }

  return { applySessionDetail };
}
