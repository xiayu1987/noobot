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
import {
  buildWorkflowMessageSignature,
  mergePreservedDetailMessages,
} from "./detailMessages.js";
import { buildSessionDetailProjection } from "./sessionDetailProjection.js";
import { mergeCanonicalSessionDetail } from "../../../chat/model/sessionDetailMerge.js";
import { promoteSessionTurnUiStates } from "../../../chat/runtime/engine/turnUiStore.js";
import { revokeMessagePreviewUrls } from "./sessionRecords.js";
import {
  logResendDebug,
  summarizeDebugMessages,
} from "../../../debug/loggers/resendDebugLogger.js";
import { logReconnectTimingDebug } from "../../../debug/loggers/reconnectTimingDebugLogger.js";
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
import {
  SESSION_DETAIL_APPLY_MODE,
  hasInFlightAssistantMissingFromDetail,
  isAuthoritativeSessionDetailApplyMode,
  normalizeSessionDetailApplyMode,
} from "../../../chat/runtime/engine/messageStateGuards.js";

export function createSessionDetailApplicator({
  sessions,
  activeSessionId,
  turnRuntimeRegistry,
  makeViewMessage,
  foldMessagesForView,
  sessionTitleFromMessages,
  navigateToLastMessage,
  isSameSessionIdentity,
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
    const requestedPreserveCurrentMessages =
      applyMode === SESSION_DETAIL_APPLY_MODE.MERGE_PRESERVE_IN_FLIGHT ||
      Boolean(options.preserveCurrentMessages);
    const shouldPreserveMissingInFlight = ![
      SESSION_DETAIL_APPLY_MODE.DELETE_CONFIRMED,
      SESSION_DETAIL_APPLY_MODE.FINALIZE_RUN,
      SESSION_DETAIL_APPLY_MODE.REPLACE,
    ].includes(applyMode);
    logResendDebug("detail.apply.begin", () => ({
      sessionId: detail.sessionId,
      requestedPreserveCurrentMessages,
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
      preserveCurrentMessages: requestedPreserveCurrentMessages,
      selectedSessionDocId: String(mainSessionDoc?.sessionId || ""),
      sessionDocCount: sessionDocs.length,
      currentCandidates: summarizeWorkflowMessages(sessionItem.messages),
      persistedCandidates: summarizeWorkflowMessages(mainSessionDoc.messages),
    }));
    const serverSessionTitle = String(
      mainSessionDoc.title || mainSessionDoc.customTitle || detail.title || "",
    ).trim();
    const isSummaryDetail = detail?.summary === true;
    sessionItem.currentTaskId = mainSessionDoc.currentTaskId || "";
    sessionItem.currentTaskStatus = "idle";
    applyLatestSessionVersion(sessionItem, mainSessionDoc);
    sessionItem.createdAt = mainSessionDoc.createdAt || sessionItem.createdAt;
    sessionItem.updatedAt = mainSessionDoc.updatedAt || sessionItem.updatedAt;

    const currentRenderedMessages = Array.isArray(sessionItem.messages)
      ? sessionItem.messages
      : [];
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
        replaceFields: isAuthoritativeSessionDetailApplyMode(applyMode)
          ? [
            ...(Array.isArray(mainSessionDoc.messages) ? ["messages"] : []),
            ...(Array.isArray(mainSessionDoc.turnStatuses) || Array.isArray(detail?.turnStatuses) ? ["turnStatuses"] : []),
            ...(Array.isArray(mainSessionDoc.turnTimings) || Array.isArray(detail?.turnTimings) ? ["turnTimings"] : []),
          ]
          : [],
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
    sessionItem.detailMessages = detailMessages.map((item) => ({ ...item }));
    const currentTurnTimings = sessionItem.turnTimingsByTurnScopeId || {};
    const detailProjection = buildSessionDetailProjection({
      sessionDetail: canonicalDetail,
      sessionDocs,
      makeViewMessage,
      foldMessagesForView,
      isSummaryDetail,
      currentTimingsByTurnScopeId: currentTurnTimings,
      onTimingHydrated: ({ item, matchingMessage, turnScopeId, current, timing }) => {
          const timingDialogProcessId = getMessageDialogProcessId(item);
          logReconnectTimingDebug("frontend.reconnectTiming.timingHydrated", () => ({
            sessionId: detail.sessionId,
            dialogProcessId: timingDialogProcessId,
            timingTurnScopeId: getMessageTurnScopeId(item),
            matchingMessageTurnScopeId: getMessageTurnScopeId(matchingMessage),
            resolvedTurnScopeId: turnScopeId,
            timingMapKeys: Object.keys(currentTurnTimings),
            detailThinkingStartedAt: item?.thinkingStartedAt || null,
            detailThinkingFinishedAt: item?.thinkingFinishedAt || null,
            previousThinkingStartedAt: current.thinkingStartedAt || null,
            previousThinkingFinishedAt: current.thinkingFinishedAt || null,
            hydratedThinkingStartedAt: timing.thinkingStartedAt,
            hydratedThinkingFinishedAt: timing.thinkingFinishedAt,
            retained: Boolean(turnScopeId),
          }));
      },
    });
    sessionItem.turnTimingsByTurnScopeId = detailProjection.turnTimingsByTurnScopeId;
    const detailTurnScopeIds = new Set(
      detailMessages.map((messageItem) => getMessageTurnScopeId(messageItem)).filter(Boolean),
    );
    const hasCurrentInFlightTurnMissingFromDetail = shouldPreserveMissingInFlight &&
      hasInFlightAssistantMissingFromDetail({
        currentMessages: currentRenderedMessages,
        detailMessages,
        registry: turnRuntimeRegistry?.value,
        sessionId: detailSessionId,
      });
    const preserveCurrentMessages =
      requestedPreserveCurrentMessages || hasCurrentInFlightTurnMissingFromDetail;
    logResendDebug("detail.apply.mode", () => ({
      sessionId: detail.sessionId,
      requestedPreserveCurrentMessages,
      applyMode,
      shouldPreserveMissingInFlight,
      hasCurrentInFlightTurnMissingFromDetail,
      preserveCurrentMessages,
      detailMessageCount: detailMessages.length,
      detailTurnScopeIds: Array.from(detailTurnScopeIds),
      currentMessages: summarizeDebugMessages(currentRenderedMessages),
    }));
    if (!preserveCurrentMessages) {
      revokeMessagePreviewUrls(sessionItem.messages || []);
    }
    const shouldKeepCurrentMessagesForEmptyDetail =
      shouldPreserveMissingInFlight &&
      !preserveCurrentMessages &&
      currentRenderedMessages.length > 0 &&
      detailMessages.length === 0 &&
      isSameSessionIdentity(detailSessionId, activeSessionId.value);

    const normalizedDetailMessages = detailProjection.messages;
    logThinkingReplayDebug("frontend.thinkingReplay.sessionDetailSnapshotReceived", () => ({
      sessionId: detail.sessionId,
      applyMode,
      summary: isSummaryDetail,
      preserveCurrentMessages,
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

    if (!preserveCurrentMessages && !shouldKeepCurrentMessagesForEmptyDetail) {
      logResendDebug("detail.apply.replaceAll", () => ({
        sessionId: detail.sessionId,
        detailMessages: summarizeDebugMessages(detailMessages),
      }));
      sessionItem.messages = normalizedDetailMessages;
    } else if (preserveCurrentMessages) {
      logResendDebug("detail.apply.preserve", () => ({
        sessionId: detail.sessionId,
        detailMessages: summarizeDebugMessages(detailMessages),
        currentMessages: summarizeDebugMessages(sessionItem.messages),
      }));
      const existingMessages = Array.isArray(sessionItem.messages) ? sessionItem.messages : [];
      mergePreservedDetailMessages(existingMessages, normalizedDetailMessages, {
        registry: turnRuntimeRegistry?.value,
        sessionId: detailSessionId,
      });
      const workflowMessages = normalizedDetailMessages.filter(
        (messageItem) =>
          getMessageRole(messageItem) === RoleEnum.ASSISTANT &&
          messageItem?.workflowMessage === true,
      );
      if (workflowMessages.length) {
        const existingWorkflowSignatures = new Set(
          existingMessages
            .filter((messageItem) => messageItem?.workflowMessage === true)
            .map((messageItem) => buildWorkflowMessageSignature(messageItem)),
        );
        for (const workflowMessageItem of workflowMessages) {
          const signature = buildWorkflowMessageSignature(workflowMessageItem);
          if (!signature || existingWorkflowSignatures.has(signature)) continue;
          existingMessages.push(workflowMessageItem);
          existingWorkflowSignatures.add(signature);
        }
      }
    } else {
      sessionItem.messages = currentRenderedMessages;
    }

    logThinkingReplayDebug("frontend.thinkingReplay.sessionDetailApplied", () => ({
      sessionId: detail.sessionId,
      applyMode,
      preserveCurrentMessages,
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
      preserveCurrentMessages,
    });
    sessionItem.messageCount = sessionItem.messages.length;
    sessionItem.lastMessage = findVisibleLastMessage(sessionItem.messages);

    if (!preserveCurrentMessages) {
      sessionItem.title = serverSessionTitle || sessionTitleFromMessages(
        sessionItem.messages,
        sessionItem.title || detail.sessionId.slice(0, 8),
      );
      const shouldNavigateToLastMessage =
        options.navigateToLastMessage !== false && options.scrollToBottom !== false;
      if (shouldNavigateToLastMessage) navigateToLastMessage?.();
    } else if (serverSessionTitle) {
      sessionItem.title = serverSessionTitle;
    }
  }

  return { applySessionDetail };
}
