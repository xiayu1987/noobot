/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../../shared/constants/chatConstants";
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
  buildWorkflowMessageSignature,
  mergeChildTurnAttachmentsIntoRootMessages,
  mergePreservedDetailMessages,
  patchExistingWorkflowMessage,
} from "./detailMessages";
import { revokeMessagePreviewUrls } from "./sessionRecords";

export function createSessionDetailApplicator({
  sessions,
  activeSessionId,
  makeViewMessage,
  foldMessagesForView,
  sessionTitleFromMessages,
  applyCompletedToolLogsToMessages,
  scrollBottom,
  isSameSessionIdentity,
  processStore = null,
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
    const preserveCurrentMessages = Boolean(options.preserveCurrentMessages);
    const sessionItem = findSessionByAnyIdInList(sessions.value, detail.sessionId);
    if (!sessionItem) return;
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
    if (!preserveCurrentMessages) {
      revokeMessagePreviewUrls(sessionItem.messages || []);
    }

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
    const isSummaryDetail = detail?.summary === true;
    sessionItem.rawMessages = (mainSessionDoc.messages || []).map((messageItem) =>
      makeViewMessage(messageItem),
    );
    sessionItem.currentTaskId = mainSessionDoc.currentTaskId || "";
    sessionItem.currentTaskStatus = "idle";
    if (mainSessionDoc.version !== undefined) sessionItem.version = mainSessionDoc.version;
    if (mainSessionDoc.revision !== undefined) sessionItem.revision = mainSessionDoc.revision;
    sessionItem.createdAt = mainSessionDoc.createdAt || sessionItem.createdAt;
    sessionItem.updatedAt = mainSessionDoc.updatedAt || sessionItem.updatedAt;

    const currentRenderedMessages = Array.isArray(sessionItem.messages)
      ? sessionItem.messages
      : [];
    const detailMessages = Array.isArray(mainSessionDoc.messages)
      ? mainSessionDoc.messages
      : [];
    const shouldKeepCurrentMessagesForEmptyDetail =
      !preserveCurrentMessages &&
      currentRenderedMessages.length > 0 &&
      detailMessages.length === 0 &&
      isSameSessionIdentity(detailSessionId, activeSessionId.value);

    if (!preserveCurrentMessages && !shouldKeepCurrentMessagesForEmptyDetail) {
      sessionItem.messages = isSummaryDetail
        ? detailMessages.map((messageItem) => makeViewMessage(messageItem))
        : foldMessagesForView(detailMessages);
      if (!isSummaryDetail) {
        mergeChildTurnAttachmentsIntoRootMessages({
          rootMessages: sessionItem.messages,
          sessionDocs,
          rootSessionId: detail.sessionId,
          makeViewMessage,
        });
      }
      for (const messageItem of sessionItem.messages || []) {
        const dialogProcessId = getMessageDialogProcessId(messageItem);
        if (!dialogProcessId) continue;
        if (openThinkingDialogProcessIds.has(dialogProcessId)) {
          messageItem.thinkingOpenNames = ["thinking-panel"];
        }
      }
    } else if (preserveCurrentMessages) {
      const foldedDetailMessages = isSummaryDetail
        ? detailMessages.map((messageItem) => makeViewMessage(messageItem))
        : foldMessagesForView(detailMessages);
      if (!isSummaryDetail) {
        mergeChildTurnAttachmentsIntoRootMessages({
          rootMessages: foldedDetailMessages,
          sessionDocs,
          rootSessionId: detail.sessionId,
          makeViewMessage,
        });
      }
      const existingMessages = Array.isArray(sessionItem.messages) ? sessionItem.messages : [];
      mergePreservedDetailMessages(existingMessages, foldedDetailMessages);
      const workflowMessages = foldedDetailMessages.filter(
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
    sessionItem.messageCount = sessionItem.messages.length;
    sessionItem.lastMessage = sessionItem.messages.length
      ? sessionItem.messages[sessionItem.messages.length - 1]
      : null;

    if (!preserveCurrentMessages) {
      sessionItem.title = sessionTitleFromMessages(
        sessionItem.messages,
        sessionItem.title || detail.sessionId.slice(0, 8),
      );
      if (options.scrollToBottom !== false) scrollBottom();
    }
  }

  return { applySessionDetail };
}
