/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ref, watch } from "vue";
import {
  buildThinkingDetailsRoute,
  getThinkingDetailsTitle as getThinkingDetailsTitleState,
  resolveFallbackThinkingDetailsPayload as resolveFallbackThinkingDetailsPayloadState,
  resolveThinkingDetailsPanelPayload,
} from "../state/thinkingDetailsState.js";
import {
  getMessageDialogProcessId,
  getMessageRole,
  getMessageTurnScopeId,
  isAssistantWithoutTurnScope,
} from "../../modules/chat/model/messageIdentity.js";
import { loadThinkingDetail } from "../../modules/chat/model/thinkingDetailCache.js";
import { selectToolTimelineCount } from "../../modules/chat/runtime/engine/toolTimeline.js";
import { selectActivityTimelineLogs } from "../../modules/chat/runtime/engine/activityTimeline.js";
import { logThinkingReplayDebug } from "../../modules/debug/loggers/thinkingReplayDebugLogger.js";

function getSessionDocsFromDetail(detail = {}) {
  if (Array.isArray(detail?.sessionDocs)) return detail.sessionDocs;
  if (Array.isArray(detail?.sessions)) return detail.sessions;
  return [];
}

function hasCanonicalTimeline(messageItem = {}) {
  return selectToolTimelineCount(messageItem) > 0 ||
    selectActivityTimelineLogs(messageItem).length > 0;
}

function isSameThinkingTurn(left = {}, right = {}) {
  if (getMessageRole(left) !== "assistant" || getMessageRole(right) !== "assistant") return false;
  const leftTurnScopeId = getMessageTurnScopeId(left);
  const rightTurnScopeId = getMessageTurnScopeId(right);
  if (leftTurnScopeId || rightTurnScopeId) {
    return Boolean(leftTurnScopeId && leftTurnScopeId === rightTurnScopeId);
  }
  const leftDialogProcessId = getMessageDialogProcessId(left);
  return Boolean(leftDialogProcessId && leftDialogProcessId === getMessageDialogProcessId(right));
}

function summarizeThinkingTimeline(messageItem = {}) {
  return {
    dialogProcessId: getMessageDialogProcessId(messageItem),
    turnScopeId: getMessageTurnScopeId(messageItem),
    pending: messageItem?.pending === true,
    hasThinkingDetails: messageItem?.hasThinkingDetails === true,
    thinkingDetailCount: Number(messageItem?.thinkingDetailCount || 0),
    activityTimelineCount: selectActivityTimelineLogs(messageItem).length,
    toolTimelineCount: selectToolTimelineCount(messageItem),
  };
}

function timelineRevision(messageItem = {}) {
  const activityRevision = selectActivityTimelineLogs(messageItem)
    .map((item = {}) => `${item.eventId || item.activityId || ""}:${item.sequence || 0}`);
  const toolRevision = (Array.isArray(messageItem?.toolTimeline) ? messageItem.toolTimeline : [])
    .map((item = {}) => [
      item.key || item.toolCallId || "",
      item.call?.eventId || "",
      item.call?.sequence || 0,
      item.resultEvent?.eventId || "",
      item.resultEvent?.sequence || 0,
      item.status || "",
    ].join(":"));
  return [...activityRevision, ...toolRevision].join("|");
}

function mergeSessionMessagesForThinkingDetail(messageItem = {}, allMessages = [], sessionDocs = []) {
  const responseMessages = Array.isArray(allMessages) ? allMessages : [];
  const turnScopeId = String(messageItem?.turnScopeId || messageItem?.turn_scope_id || "").trim();
  const dialogProcessId = getMessageDialogProcessId(messageItem);
  const hasScopedResponseMessages = responseMessages.some((item = {}) => {
    const itemTurnScopeId = String(item?.turnScopeId || item?.turn_scope_id || "").trim();
    if (turnScopeId && itemTurnScopeId === turnScopeId) return true;
    return Boolean(dialogProcessId && (
      getMessageDialogProcessId(item) === dialogProcessId ||
      String(item?.parentDialogProcessId || item?.parent_dialog_process_id || "").trim() === dialogProcessId
    ));
  });
  if (hasScopedResponseMessages) return responseMessages;
  const sessionMessages = (Array.isArray(sessionDocs) ? sessionDocs : []).flatMap((doc = {}) =>
    Array.isArray(doc.messages) ? doc.messages : (Array.isArray(doc.messageList) ? doc.messageList : []),
  );
  return sessionMessages.length > 0 ? [...responseMessages, ...sessionMessages] : responseMessages;
}

export function useThinkingDetailsPanel({
  activeSession,
  activeSessionId,
  fetchThinkingDetail,
  notify,
  translate,
  closeAllDrawers,
  closeMobileSidebar,
  closeComposerMorePanel,
  pushPseudoRoute,
  thinkingDetailsPanel,
} = {}) {
  const thinkingDetailsVisible = ref(false);
  const thinkingDetailsMessageItem = ref(null);
  const thinkingDetailsAllMessages = ref([]);
  let currentFetchDetail = null;
  let detailRequestVersion = 0;
  let detailWatchSkipKey = "";

  function resolveFallbackThinkingDetailsPayload() {
    return resolveFallbackThinkingDetailsPayloadState(activeSession?.value);
  }

  function closeThinkingDetailsPanel() {
    thinkingDetailsVisible.value = false;
    currentFetchDetail = null;
    detailRequestVersion += 1;
    detailWatchSkipKey = "";
  }

  function getThinkingDetailsTitle(messageItem = {}) {
    return getThinkingDetailsTitleState(messageItem, translate);
  }

  function normalizeDialogProcessId(messageItem = {}) {
    return getMessageDialogProcessId(messageItem);
  }

  async function fetchThinkingDetailForMessage(messageItem = {}, fetchDetailOverride = null) {
    const dialogProcessId = normalizeDialogProcessId(messageItem);
    const turnScopeId = String(messageItem?.turnScopeId || messageItem?.turn_scope_id || "").trim();
    if (!dialogProcessId && !turnScopeId) return null;
    const runFetchDetail = typeof fetchDetailOverride === "function"
      ? fetchDetailOverride
      : typeof currentFetchDetail === "function"
        ? currentFetchDetail
        : fetchThinkingDetail;
    if (typeof runFetchDetail !== "function") return null;
    return loadThinkingDetail({
      sessionId: activeSessionId?.value,
      messageItem,
      dialogProcessId,
      turnScopeId,
      fetchThinkingDetail: runFetchDetail,
      refresh: true,
    });
  }

  function findActiveCanonicalMessage(messageItem = {}) {
    return (activeSession?.value?.messages || [])
      .find((candidate = {}) => isSameThinkingTurn(messageItem, candidate)) || null;
  }

  function buildDetailWatchKey() {
    if (!thinkingDetailsVisible.value) return "";
    const messageItem = thinkingDetailsMessageItem.value || {};
    const sourceMessage = findActiveCanonicalMessage(messageItem) || {};
    return [
      activeSessionId?.value,
      normalizeDialogProcessId(messageItem),
      getMessageTurnScopeId(messageItem),
      sourceMessage?.pending === true ? "pending" : "done",
      Number(sourceMessage?.thinkingDetailCount || 0),
      timelineRevision(sourceMessage),
    ].join("::");
  }

  async function openThinkingDetailsPanel(payload = {}) {
    const fallbackPayload = resolveFallbackThinkingDetailsPayload();
    const initialPayload = resolveThinkingDetailsPanelPayload(payload, fallbackPayload);
    const payloadMessageItem = initialPayload.messageItem;
    const activeMessageItem = findActiveCanonicalMessage(payloadMessageItem);
    const initialMessageItem = activeMessageItem || payloadMessageItem;
    if (isAssistantWithoutTurnScope(initialMessageItem)) return;
    const hasLocalThinkingDetails = hasCanonicalTimeline(initialMessageItem);
    const requestFetchDetail = typeof payload?.fetchThinkingDetail === "function"
      ? payload.fetchThinkingDetail
      : null;
    currentFetchDetail = requestFetchDetail || fetchThinkingDetail;
    const openRequestVersion = ++detailRequestVersion;
    logThinkingReplayDebug("frontend.thinkingReplay.detailPanelOpenResolved", {
      sessionId: activeSessionId?.value,
      payload: summarizeThinkingTimeline(payloadMessageItem),
      active: summarizeThinkingTimeline(activeMessageItem || {}),
      selectedSource: activeMessageItem ? "active-session" : "payload",
      hasLocalThinkingDetails,
    });
    const needsFullDetail = Boolean(initialMessageItem && payload?.skipFetch !== true);
    let loadedThinkingDetail = null;
    if (needsFullDetail) {
      try {
        loadedThinkingDetail = await fetchThinkingDetailForMessage(initialMessageItem, requestFetchDetail);
        if (openRequestVersion !== detailRequestVersion) return;
        logThinkingReplayDebug("frontend.thinkingReplay.detailPanelRequestCommitted", {
          sessionId: activeSessionId?.value,
          requested: summarizeThinkingTimeline(initialMessageItem),
          detail: summarizeThinkingTimeline(loadedThinkingDetail?.messageItem || {}),
          allMessageCount: Array.isArray(loadedThinkingDetail?.allMessages)
            ? loadedThinkingDetail.allMessages.length
            : 0,
          injectedMessageCount: Number(loadedThinkingDetail?.counts?.injectedMessageCount || 0),
        });
      } catch (error) {
        if (openRequestVersion !== detailRequestVersion) return;
        notify?.({ type: "warning", message: error?.message || translate?.("chat.loadSessionDetailFailed") });
      }
    }
    const detailPayload = loadedThinkingDetail
      ? {
        messageItem: hasLocalThinkingDetails
          ? initialMessageItem
          : loadedThinkingDetail.messageItem,
        allMessages: loadedThinkingDetail.allMessages,
        sessionDocs: getSessionDocsFromDetail(loadedThinkingDetail),
      }
      : { ...payload, ...initialPayload, messageItem: initialMessageItem };
    const { messageItem, allMessages } = resolveThinkingDetailsPanelPayload(detailPayload, fallbackPayload);
    const sessionDocs = getSessionDocsFromDetail(detailPayload);
    if (!messageItem) return;
    closeAllDrawers?.();
    closeMobileSidebar?.();
    closeComposerMorePanel?.();
    thinkingDetailsMessageItem.value = messageItem;
    thinkingDetailsAllMessages.value = mergeSessionMessagesForThinkingDetail(
      messageItem,
      allMessages,
      sessionDocs,
    );
    thinkingDetailsVisible.value = true;
    detailWatchSkipKey = buildDetailWatchKey();
    if (payload?.pushRoute !== false) {
      pushPseudoRoute?.(buildThinkingDetailsRoute(activeSessionId?.value, thinkingDetailsPanel));
    }
  }

  watch(
    buildDetailWatchKey,
    async (watchKey) => {
      if (!thinkingDetailsVisible.value) return;
      if (watchKey && watchKey === detailWatchSkipKey) {
        detailWatchSkipKey = "";
        return;
      }
      const currentMessage = thinkingDetailsMessageItem.value;
      const dialogProcessId = normalizeDialogProcessId(currentMessage);
      const turnScopeId = String(currentMessage?.turnScopeId || currentMessage?.turn_scope_id || "").trim();
      if (!dialogProcessId && !turnScopeId) return;
      const sourceMessage = findActiveCanonicalMessage(currentMessage);
      if (hasCanonicalTimeline(sourceMessage)) {
        detailRequestVersion += 1;
        thinkingDetailsMessageItem.value = sourceMessage;
        logThinkingReplayDebug("frontend.thinkingReplay.detailPanelCanonicalSynchronized", {
          sessionId: activeSessionId?.value,
          source: summarizeThinkingTimeline(sourceMessage),
          preservedAllMessageCount: thinkingDetailsAllMessages.value.length,
          preservedInjectedMessageCount: thinkingDetailsAllMessages.value
            .filter((item = {}) => item?.injectedMessage === true).length,
        });
        return;
      }
      const requestVersion = ++detailRequestVersion;
      try {
        const detail = await fetchThinkingDetailForMessage(currentMessage);
        const latestMessage = thinkingDetailsMessageItem.value || {};
        if (requestVersion !== detailRequestVersion || !detail ||
            normalizeDialogProcessId(latestMessage) !== dialogProcessId ||
            String(latestMessage?.turnScopeId || latestMessage?.turn_scope_id || "").trim() !== turnScopeId) return;
        thinkingDetailsMessageItem.value = detail.messageItem || currentMessage;
        const detailSessionDocs = getSessionDocsFromDetail(detail);
        thinkingDetailsAllMessages.value = mergeSessionMessagesForThinkingDetail(
          detail.messageItem || currentMessage,
          detail.allMessages,
          detailSessionDocs,
        );
      } catch {
      }
    },
  );

  return {
    thinkingDetailsVisible,
    thinkingDetailsMessageItem,
    thinkingDetailsAllMessages,
    closeThinkingDetailsPanel,
    getThinkingDetailsTitle,
    openThinkingDetailsPanel,
  };
}
