/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../../shared/constants/chatConstants";
import { findVisibleLastMessage } from "../../infra/messageModel";
import { ProcessEventSource, ProcessStatus } from "../../../shared/process/protocol";
import { createProcessSnapshotFromLogs } from "../../../shared/process/aggregator";
import {
  findSessionByAnyId as findSessionByAnyIdInList,
  promoteSessionIdentityToBackendId,
} from "../../infra/sessionIdentity";
import {
  clearTurnScopedAssets,
  getMessageDialogProcessId,
  getMessageRole,
  getMessageTurnScopeId,
  isAssistantWithoutTurnScope,
} from "../../infra/messageIdentity";
import {
  applySummaryToolLogs,
  buildNormalizedDetailMessages,
  buildWorkflowMessageSignature,
  mergePreservedDetailMessages,
  patchExistingWorkflowMessage,
} from "./detailMessages";
import { revokeMessagePreviewUrls } from "./sessionRecords";
import {
  logResendDebug,
  summarizeDebugMessages,
} from "../debug/resendDebugLogger";
import { applyLatestSessionVersion } from "../chatEngine/sessionVersionManager";
import {
  SESSION_DETAIL_APPLY_MODE,
  hasInFlightAssistantMissingFromDetail,
  normalizeSessionDetailApplyMode,
} from "../chatEngine/messageStateGuards";

export function createSessionDetailApplicator({
  sessions,
  activeSessionId,
  makeViewMessage,
  foldMessagesForView,
  sessionTitleFromMessages,
  applyCompletedToolLogsToMessages,
  navigateToLastMessage,
  isSameSessionIdentity,
  processStore = null,
  onSessionDetailApplied = null,
} = {}) {
  function hydrateProcessSnapshotsFromMessages(messages = []) {
    if (!processStore) return;
    for (const messageItem of messages || []) {
      if (getMessageRole(messageItem) !== RoleEnum.ASSISTANT) continue;
      if (isAssistantWithoutTurnScope(messageItem)) {
        clearTurnScopedAssets(messageItem);
        continue;
      }
      const dialogProcessId = getMessageDialogProcessId(messageItem);
      if (!dialogProcessId) continue;
      const completedToolLogs = Array.isArray(messageItem?.completedToolLogs)
        ? messageItem.completedToolLogs
        : [];
      if (!completedToolLogs.length) continue;
      const snapshot = createProcessSnapshotFromLogs({
        processId: dialogProcessId,
        logs: completedToolLogs,
        status: ProcessStatus.SUCCEEDED,
        source: ProcessEventSource.SESSION_DETAIL,
      });
      processStore.hydrateSnapshot?.(snapshot);
      const compatView = processStore.getCompatView?.(dialogProcessId);
      if (!compatView || compatView.executionLogTotal <= 0) continue;
      messageItem.processId = dialogProcessId;
      messageItem.processLastSequence = compatView.lastSequence;
      messageItem.processRealtimeLogs = compatView.realtimeLogs;
      messageItem.processCompletedToolLogs = compatView.completedToolLogs;
      messageItem.processExecutionLogTotal = compatView.executionLogTotal;
    }
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
    logResendDebug("detail.apply.begin", {
      sessionId: detail.sessionId,
      requestedPreserveCurrentMessages,
      applyMode,
      currentMessages: summarizeDebugMessages(sessionItem.messages),
    });
    const openThinkingDialogProcessIds = new Set(
      (sessionItem.messages || [])
        .filter(
          (messageItem) =>
            getMessageRole(messageItem) === RoleEnum.ASSISTANT &&
            Array.isArray(messageItem?.thinkingOpenNames) &&
            messageItem.thinkingOpenNames.includes("thinking-panel") &&
            getMessageDialogProcessId(messageItem),
        )
        .map((messageItem) => getMessageDialogProcessId(messageItem)),
    );
    const detailSessionId = String(detail.sessionId || "").trim();
    sessionItem.loaded = true;
    const promotionResult = promoteSessionIdentityToBackendId({
      sessionItem,
      backendSessionId: detailSessionId,
      activeSessionId: activeSessionId.value,
    });
    activeSessionId.value = promotionResult.nextActiveSessionId;
    const sessionDocs = Array.isArray(detail.sessions) ? detail.sessions : [];
    sessionItem.sessionDocs = sessionDocs;
    const mainSessionDoc =
      sessionDocs.find((doc) => doc.sessionId === detail.sessionId) ||
      sessionDocs[0] ||
      {};
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
    const detailMessages = Array.isArray(mainSessionDoc.messages)
      ? mainSessionDoc.messages
      : [];
    const turnTimings = Array.isArray(mainSessionDoc.turnTimings)
      ? mainSessionDoc.turnTimings
      : [];
    const turnStatuses = Array.isArray(mainSessionDoc.turnStatuses)
      ? mainSessionDoc.turnStatuses
      : Array.isArray(detail?.turnStatuses)
        ? detail.turnStatuses
        : [];
    // Keep the authoritative session-level facts on the session model. View
    // messages below are a disposable projection and must not become the
    // source used by hydration, continue, or resend flows.
    sessionItem.turnStatuses = turnStatuses.map((item) => ({ ...item }));
    sessionItem.turnTimingsByTurnScopeId = Object.fromEntries(
      turnTimings
        .map((item) => [getMessageTurnScopeId(item), {
          thinkingStartedAt: item?.thinkingStartedAt || null,
          thinkingFinishedAt: item?.thinkingFinishedAt || null,
        }])
        .filter(([turnScopeId]) => Boolean(turnScopeId)),
    );
    const detailTurnScopeIds = new Set(
      detailMessages.map((messageItem) => getMessageTurnScopeId(messageItem)).filter(Boolean),
    );
    const hasCurrentInFlightTurnMissingFromDetail = shouldPreserveMissingInFlight &&
      hasInFlightAssistantMissingFromDetail({
        currentMessages: currentRenderedMessages,
        detailMessages,
      });
    const preserveCurrentMessages =
      requestedPreserveCurrentMessages || hasCurrentInFlightTurnMissingFromDetail;
    logResendDebug("detail.apply.mode", {
      sessionId: detail.sessionId,
      requestedPreserveCurrentMessages,
      applyMode,
      shouldPreserveMissingInFlight,
      hasCurrentInFlightTurnMissingFromDetail,
      preserveCurrentMessages,
      detailMessageCount: detailMessages.length,
      detailTurnScopeIds: Array.from(detailTurnScopeIds),
      currentMessages: summarizeDebugMessages(currentRenderedMessages),
    });
    if (!preserveCurrentMessages) {
      revokeMessagePreviewUrls(sessionItem.messages || []);
    }
    const shouldKeepCurrentMessagesForEmptyDetail =
      shouldPreserveMissingInFlight &&
      !preserveCurrentMessages &&
      currentRenderedMessages.length > 0 &&
      detailMessages.length === 0 &&
      isSameSessionIdentity(detailSessionId, activeSessionId.value);

    const normalizedDetailMessages = buildNormalizedDetailMessages({
      detailMessages,
      sessionDocs,
      rootSessionId: detail.sessionId,
      turnTimings,
      turnStatuses,
      makeViewMessage,
      foldMessagesForView,
      isSummaryDetail,
    });

    if (!preserveCurrentMessages && !shouldKeepCurrentMessagesForEmptyDetail) {
      logResendDebug("detail.apply.replaceAll", {
        sessionId: detail.sessionId,
        detailMessages: summarizeDebugMessages(detailMessages),
      });
      sessionItem.messages = normalizedDetailMessages;
      for (const messageItem of sessionItem.messages || []) {
        const dialogProcessId = getMessageDialogProcessId(messageItem);
        if (!dialogProcessId) continue;
        if (openThinkingDialogProcessIds.has(dialogProcessId)) {
          messageItem.thinkingOpenNames = ["thinking-panel"];
        }
      }
    } else if (preserveCurrentMessages) {
      logResendDebug("detail.apply.preserve", {
        sessionId: detail.sessionId,
        detailMessages: summarizeDebugMessages(detailMessages),
        currentMessages: summarizeDebugMessages(sessionItem.messages),
      });
      const existingMessages = Array.isArray(sessionItem.messages) ? sessionItem.messages : [];
      mergePreservedDetailMessages(existingMessages, normalizedDetailMessages);
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
          const workflowDialogProcessId = getMessageDialogProcessId(workflowMessageItem);
          const existingAssistantForDialog = existingMessages.find(
            (messageItem) =>
              getMessageRole(messageItem) === RoleEnum.ASSISTANT &&
              messageItem?.workflowMessage !== true &&
              workflowDialogProcessId &&
              getMessageDialogProcessId(messageItem) === workflowDialogProcessId,
          );
          if (patchExistingWorkflowMessage(existingAssistantForDialog, workflowMessageItem)) {
            existingWorkflowSignatures.add(signature);
            continue;
          }
          existingMessages.push(workflowMessageItem);
          existingWorkflowSignatures.add(signature);
        }
      }
    } else {
      // The backend detail endpoint can be briefly stale right after a DONE event.
      // Do not replace a non-empty active chat with an empty snapshot; otherwise
      // the whole visible conversation disappears for one completed turn.
      sessionItem.messages = currentRenderedMessages;
    }

    if (isSummaryDetail) {
      applySummaryToolLogs(sessionItem, sessionDocs);
    } else {
      applyCompletedToolLogsToMessages(sessionItem.messages, sessionDocs);
    }
    hydrateProcessSnapshotsFromMessages(sessionItem.messages);
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
