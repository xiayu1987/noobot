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
} from "./state/thinkingDetailsState";
import {
  getMessageDialogProcessId,
  getMessageRole,
  isAssistantWithoutTurnScope,
} from "../composables/infra/messageIdentity";

function getSessionDocsFromDetail(detail = {}) {
  if (Array.isArray(detail?.sessionDocs)) return detail.sessionDocs;
  if (Array.isArray(detail?.sessions)) return detail.sessions;
  return [];
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

  function resolveFallbackThinkingDetailsPayload() {
    return resolveFallbackThinkingDetailsPayloadState(activeSession?.value);
  }

  function closeThinkingDetailsPanel() {
    thinkingDetailsVisible.value = false;
    currentFetchDetail = null;
    detailRequestVersion += 1;
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
    return runFetchDetail(activeSessionId?.value, { dialogProcessId, turnScopeId });
  }

  async function openThinkingDetailsPanel(payload = {}) {
    const fallbackPayload = resolveFallbackThinkingDetailsPayload();
    const initialPayload = resolveThinkingDetailsPanelPayload(payload, fallbackPayload);
    const initialMessageItem = initialPayload.messageItem;
    if (isAssistantWithoutTurnScope(initialMessageItem)) return;
    const hasLocalThinkingDetails =
      (Array.isArray(initialMessageItem?.processRealtimeLogs) &&
        initialMessageItem.processRealtimeLogs.length > 0) ||
      (Array.isArray(initialMessageItem?.realtimeLogs) &&
        initialMessageItem.realtimeLogs.length > 0) ||
      (Array.isArray(initialMessageItem?.processCompletedToolLogs) &&
        initialMessageItem.processCompletedToolLogs.length > 0) ||
      (Array.isArray(initialMessageItem?.completedToolLogs) &&
        initialMessageItem.completedToolLogs.length > 0);
    const requestFetchDetail = typeof payload?.fetchThinkingDetail === "function"
      ? payload.fetchThinkingDetail
      : null;
    // Select the fetcher for this request before loading anything. Otherwise
    // a normal message opened after a workflow node can reuse the node fetcher
    // that is still stored from the previous drawer contents.
    currentFetchDetail = requestFetchDetail || fetchThinkingDetail;
    const openRequestVersion = ++detailRequestVersion;
    const needsFullDetail =
      initialMessageItem &&
      payload?.skipFetch !== true &&
      (
        payload?.forceFetch === true ||
        (
          (initialMessageItem.hasThinkingDetails === true || Number(initialMessageItem.thinkingDetailCount || 0) > 0) &&
          !hasLocalThinkingDetails
        )
      );
    let loadedThinkingDetail = null;
    if (needsFullDetail) {
      try {
        loadedThinkingDetail = await fetchThinkingDetailForMessage(initialMessageItem, requestFetchDetail);
        if (openRequestVersion !== detailRequestVersion) return;
      } catch (error) {
        if (openRequestVersion !== detailRequestVersion) return;
        notify?.({ type: "warning", message: error?.message || translate?.("chat.loadSessionDetailFailed") });
      }
    }
    const detailPayload = loadedThinkingDetail
      ? {
        messageItem: loadedThinkingDetail.messageItem,
        allMessages: loadedThinkingDetail.allMessages,
        sessionDocs: getSessionDocsFromDetail(loadedThinkingDetail),
      }
      : payload;
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
    if (payload?.pushRoute !== false) {
      pushPseudoRoute?.(buildThinkingDetailsRoute(activeSessionId?.value, thinkingDetailsPanel));
    }
  }

  watch(
    () => {
      if (!thinkingDetailsVisible.value) return "";
      const dialogProcessId = normalizeDialogProcessId(thinkingDetailsMessageItem.value);
      const turnScopeId = String(thinkingDetailsMessageItem.value?.turnScopeId || thinkingDetailsMessageItem.value?.turn_scope_id || "").trim();
      if (!dialogProcessId && !turnScopeId) return "";
      const sourceMessage = (activeSession?.value?.messages || [])
        .find((item = {}) => normalizeDialogProcessId(item) === dialogProcessId && getMessageRole(item) === "assistant") || {};
      return [
        activeSessionId?.value,
        dialogProcessId,
        turnScopeId,
        sourceMessage?.pending === true ? "pending" : "done",
        Number(sourceMessage?.thinkingDetailCount || 0),
      ].join("::");
    },
    async () => {
      if (!thinkingDetailsVisible.value) return;
      const currentMessage = thinkingDetailsMessageItem.value;
      const dialogProcessId = normalizeDialogProcessId(currentMessage);
      const turnScopeId = String(currentMessage?.turnScopeId || currentMessage?.turn_scope_id || "").trim();
      if (!dialogProcessId && !turnScopeId) return;
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
        // Keep the already opened panel stable; explicit open still reports load errors.
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
