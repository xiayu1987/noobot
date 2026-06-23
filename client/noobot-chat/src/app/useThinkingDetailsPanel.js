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
  isAssistantWithoutTurnScope,
} from "../composables/infra/messageIdentity";

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
  const thinkingDetailsFetchDetail = ref(null);

  function resolveFallbackThinkingDetailsPayload() {
    return resolveFallbackThinkingDetailsPayloadState(activeSession?.value);
  }

  function closeThinkingDetailsPanel() {
    thinkingDetailsVisible.value = false;
    thinkingDetailsFetchDetail.value = null;
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
      : typeof thinkingDetailsFetchDetail.value === "function"
        ? thinkingDetailsFetchDetail.value
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
      } catch (error) {
        notify?.({ type: "warning", message: error?.message || translate?.("chat.loadSessionDetailFailed") });
      }
    }
    const detailPayload = loadedThinkingDetail
      ? { messageItem: loadedThinkingDetail.messageItem, allMessages: loadedThinkingDetail.allMessages }
      : payload;
    const { messageItem, allMessages } = resolveThinkingDetailsPanelPayload(detailPayload, fallbackPayload);
    if (!messageItem) return;
    closeAllDrawers?.();
    closeMobileSidebar?.();
    closeComposerMorePanel?.();
    thinkingDetailsMessageItem.value = messageItem;
    thinkingDetailsAllMessages.value = allMessages;
    thinkingDetailsFetchDetail.value = requestFetchDetail;
    thinkingDetailsVisible.value = true;
    if (payload?.pushRoute !== false) {
      pushPseudoRoute?.(buildThinkingDetailsRoute(activeSessionId?.value, thinkingDetailsPanel));
    }
  }

  watch(
    () => {
      if (!thinkingDetailsVisible.value) return "";
      const dialogProcessId = normalizeDialogProcessId(thinkingDetailsMessageItem.value);
      if (!dialogProcessId) return "";
      const sourceMessage = (activeSession?.value?.messages || [])
        .find((item = {}) => normalizeDialogProcessId(item) === dialogProcessId && getMessageRole(item) === "assistant") || {};
      return [
        activeSessionId?.value,
        dialogProcessId,
        sourceMessage?.pending === true ? "pending" : "done",
        Number(sourceMessage?.thinkingDetailCount || 0),
      ].join("::");
    },
    async () => {
      if (!thinkingDetailsVisible.value) return;
      const currentMessage = thinkingDetailsMessageItem.value;
      const dialogProcessId = normalizeDialogProcessId(currentMessage);
      if (!dialogProcessId) return;
      try {
        const detail = await fetchThinkingDetailForMessage(currentMessage);
        if (!detail || normalizeDialogProcessId(thinkingDetailsMessageItem.value) !== dialogProcessId) return;
        thinkingDetailsMessageItem.value = detail.messageItem || currentMessage;
        thinkingDetailsAllMessages.value = Array.isArray(detail.allMessages) ? detail.allMessages : [];
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
