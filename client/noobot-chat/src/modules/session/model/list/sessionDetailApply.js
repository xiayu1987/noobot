/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../../chat/model/chatConstants.js";
import { findVisibleLastMessage } from "../../../chat/model/messageModel.js";
import {
  findSessionByAnyId as findSessionByAnyIdInList,
  promoteSessionIdentityToBackendId,
} from "../../../chat/model/sessionIdentity.js";
import {
  clearTurnScopedAssets,
  getMessageDialogProcessId,
  getMessageRole,
  getMessageTurnScopeId,
} from "../../../chat/model/messageIdentity.js";
import { buildSessionDetailProjection } from "./sessionDetailProjection.js";
import { mergeCanonicalSessionDetail } from "../../../chat/model/sessionDetailMerge.js";
import { promoteSessionTurnUiStates } from "../../../chat/runtime/engine/turnUiStore.js";
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
import { applyLatestSessionVersion } from "../../../chat/runtime/engine/sessionVersionManager.js";
import {
  confirmTurnRuntimeDeletion,
  isTurnRuntimeDeleted,
} from "../../../chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { normalizeSessionDetailApplyMode } from "../../../chat/runtime/engine/messageStateGuards.js";

export function createSessionDetailApplicator({
  sessions,
  activeSessionId,
  turnRuntimeRegistry,
  chatStore,
  makeViewMessage,
  sessionTitleFromMessages,
  navigateToLastMessage,
  onSessionDetailApplied = null,
} = {}) {
  function pruneMessagesFromConfirmedDeletes(messages = [], sessionId = "") {
    const source = Array.isArray(messages) ? messages : [];
    const index = source.findIndex((messageItem) => isTurnRuntimeDeleted(
      turnRuntimeRegistry?.value,
      { sessionId, turnScopeId: getMessageTurnScopeId(messageItem) },
    ));
    return index >= 0 ? source.slice(0, index) : source;
  }

  function summarizeToolProjection(messageItem = {}) {
    return {
      role: getMessageRole(messageItem),
      pending: messageItem?.pending === true,
      dialogProcessId: getMessageDialogProcessId(messageItem),
      turnScopeId: getMessageTurnScopeId(messageItem),
      toolTimelineCount: Array.isArray(messageItem?.toolTimeline) ? messageItem.toolTimeline.length : 0,
      activityTimelineCount: Array.isArray(messageItem?.activityTimeline) ? messageItem.activityTimeline.length : 0,
    };
  }

  function applySessionDetail(detail, options = {}) {
    const sessionItem = findSessionByAnyIdInList(sessions.value, detail.sessionId);
    if (!sessionItem) return;
    const applyMode = normalizeSessionDetailApplyMode(options.mode);
    logResendDebug("detail.apply.begin", () => ({
      sessionId: detail.sessionId,
      applyMode,
      currentMessages: summarizeDebugMessages(sessionItem.messages),
    }));
    const detailSessionId = String(detail.sessionId || "").trim();
    const deletedTurnScopeIds = [
      ...(Array.isArray(options.deletedTurnScopeIds) ? options.deletedTurnScopeIds : []),
      options.deleteFromTurnScopeId,
    ].map((value) => String(value || "").trim()).filter(Boolean);
    if (deletedTurnScopeIds.length) {
      confirmTurnRuntimeDeletion(turnRuntimeRegistry?.value, deletedTurnScopeIds, {
        sessionId: detailSessionId,
      });
    }
    sessionItem.loaded = true;
    const previousSessionId = String(sessionItem.id || "").trim();
    const promotionResult = promoteSessionIdentityToBackendId({
      sessionItem,
      backendSessionId: detailSessionId,
      activeSessionId: activeSessionId.value,
    });
    if (promotionResult.changed) {
      promoteSessionTurnUiStates(previousSessionId, detailSessionId);
    }
    activeSessionId.value = promotionResult.nextActiveSessionId;
    const sessionDocs = Array.isArray(detail.sessions) ? detail.sessions : [];
    sessionItem.sessionDocs = sessionDocs;
    const mainSessionDoc =
      sessionDocs.find((doc) => doc.sessionId === detail.sessionId) ||
      sessionDocs[0] ||
      {};
    logWorkflowDiagnostics("frontend.workflowDetail.applySourceSelected", () => ({
      sessionId: detailSessionId,
      applyMode,
      selectedSessionDocId: String(mainSessionDoc?.sessionId || ""),
      sessionDocCount: sessionDocs.length,
      currentCandidates: summarizeWorkflowMessages(sessionItem.messages),
      persistedCandidates: summarizeWorkflowMessages(mainSessionDoc.messages),
    }));
    const serverSessionTitle = String(
      mainSessionDoc.title || mainSessionDoc.customTitle || detail.title || "",
    ).trim();
    const hasMessageSnapshot = Array.isArray(mainSessionDoc.messages);
    sessionItem.currentTaskId = mainSessionDoc.currentTaskId || "";
    sessionItem.currentTaskStatus = "idle";
    // Keep the authoritative lifecycle snapshot attached to the canonical
    // session object.  sessionLifecycleHydration is the single consumer that
    // projects it into turnRuntimeRegistry; dropping it here makes a detail
    // refresh silently fall back to the non-authoritative session view.
    const turnLifecycleSnapshot = [
      mainSessionDoc?.turnLifecycleSnapshot,
      detail?.turnLifecycleSnapshot,
    ].find((value) => value && typeof value === "object") || null;
    if (turnLifecycleSnapshot) {
      sessionItem.turnLifecycleSnapshot = turnLifecycleSnapshot;
    }
    applyLatestSessionVersion(sessionItem, mainSessionDoc);
    sessionItem.createdAt = mainSessionDoc.createdAt || sessionItem.createdAt;
    sessionItem.updatedAt = mainSessionDoc.updatedAt || sessionItem.updatedAt;

    const canonicalDetail = mergeCanonicalSessionDetail(
      {
        sessionId: detailSessionId,
        messages: sessionItem.detailMessages || [],
        turnStatuses: sessionItem.turnStatuses || [],
        turnTimings: sessionItem.turnTimings || [],
      },
      {
        sessionId: detailSessionId,
        messages: mainSessionDoc.messages,
        turnStatuses: mainSessionDoc.turnStatuses || detail?.turnStatuses,
        turnTimings: mainSessionDoc.turnTimings,
      },
      {
        replaceFields: [
          ...(Array.isArray(mainSessionDoc.messages) ? ["messages"] : []),
          ...(Array.isArray(mainSessionDoc.turnStatuses) || Array.isArray(detail?.turnStatuses) ? ["turnStatuses"] : []),
          ...(Array.isArray(mainSessionDoc.turnTimings) || Array.isArray(detail?.turnTimings) ? ["turnTimings"] : []),
        ],
      },
    );
    const detailMessages = pruneMessagesFromConfirmedDeletes(canonicalDetail.messages, detailSessionId);
    if (detailMessages !== canonicalDetail.messages) {
      canonicalDetail.messages = detailMessages;
    }
    const turnTimings = canonicalDetail.turnTimings.filter((item) => !isTurnRuntimeDeleted(
      turnRuntimeRegistry?.value,
      { sessionId: detailSessionId, turnScopeId: item?.turnScopeId },
    ));
    const turnStatuses = canonicalDetail.turnStatuses.filter((item) => !isTurnRuntimeDeleted(
      turnRuntimeRegistry?.value,
      { sessionId: detailSessionId, turnScopeId: item?.turnScopeId },
    ));
    canonicalDetail.turnTimings = turnTimings;
    canonicalDetail.turnStatuses = turnStatuses;
    sessionItem.turnStatuses = turnStatuses.map((item) => ({ ...item }));
    sessionItem.turnTimings = turnTimings.map((item) => ({ ...item }));
    if (hasMessageSnapshot) {
      sessionItem.detailMessages = detailMessages.map((item) => ({ ...item }));
    }
    const detailProjection = buildSessionDetailProjection({
      sessionDetail: canonicalDetail,
      sessionDocs,
      makeViewMessage,
    });
    chatStore?.applyTurnTimingSnapshot?.({
      sessionId: detailSessionId,
      turnTimings,
    });
    logResendDebug("detail.apply.mode", () => ({
      sessionId: detail.sessionId,
      applyMode,
      authority: "session_detail",
      hasMessageSnapshot,
      detailMessageCount: detailMessages.length,
      detailTurnScopeIds: [...new Set(
        detailMessages.map((messageItem) => getMessageTurnScopeId(messageItem)).filter(Boolean),
      )],
    }));
    if (hasMessageSnapshot) revokeMessagePreviewUrls(sessionItem.messages || []);

    const normalizedDetailMessages = hasMessageSnapshot
      ? detailProjection.messages
      : sessionItem.messages;
    logThinkingReplayDebug("frontend.thinkingReplay.sessionDetailSnapshotReceived", () => ({
      sessionId: detail.sessionId,
      applyMode,
      detailMode: String(detail?.detailMode || (detail?.summary === true ? "summary" : "")),
      rawMessageCount: Array.isArray(mainSessionDoc?.messages) ? mainSessionDoc.messages.length : 0,
      normalizedMessageCount: normalizedDetailMessages.length,
      assistantMessages: normalizedDetailMessages
        .filter((item) => getMessageRole(item) === RoleEnum.ASSISTANT)
        .map((item) => ({
          ...summarizeToolProjection(item),
          activityTimelineFacts: (item.activityTimeline || []).slice(0, 64).map((activity = {}) => ({
            eventId: String(activity.eventId || ""),
            activityKind: String(activity.type || activity.activityKind || ""),
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
      applyMode,
      renderedMessageCount: sessionItem.messages.length,
      assistantMessages: sessionItem.messages
        .filter((item) => getMessageRole(item) === RoleEnum.ASSISTANT)
        .map(summarizeToolProjection),
    }));
    onSessionDetailApplied?.({
      detail,
      sessionItem,
      mainSessionDoc,
      normalizedDetailMessages,
    });
    sessionItem.messageCount = sessionItem.messages.length;
    sessionItem.lastMessage = findVisibleLastMessage(sessionItem.messages);

    sessionItem.title = serverSessionTitle || sessionTitleFromMessages(
      sessionItem.messages,
      sessionItem.title || detail.sessionId.slice(0, 8),
    );
    const shouldNavigateToLastMessage =
      options.navigateToLastMessage !== false && options.scrollToBottom !== false;
    if (shouldNavigateToLastMessage) navigateToLastMessage?.();
  }

  return { applySessionDetail };
}
