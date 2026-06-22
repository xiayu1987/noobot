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
import { getMessageDialogProcessId, getMessageRole } from "../composables/infra/messageIdentity";

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

  function resolveFallbackThinkingDetailsPayload() {
    return resolveFallbackThinkingDetailsPayloadState(activeSession?.value);
  }

  function closeThinkingDetailsPanel() {
    thinkingDetailsVisible.value = false;
  }

  function getThinkingDetailsTitle(messageItem = {}) {
    return getThinkingDetailsTitleState(messageItem, translate);
  }

  function normalizeDialogProcessId(messageItem = {}) {
    return getMessageDialogProcessId(messageItem);
  }

  async function fetchThinkingDetailForMessage(messageItem = {}) {
    const dialogProcessId = normalizeDialogProcessId(messageItem);
    if (!dialogProcessId || typeof fetchThinkingDetail !== "function") return null;
    return fetchThinkingDetail(activeSessionId?.value, { dialogProcessId });
  }

  async function openThinkingDetailsPanel(payload = {}) {
    const fallbackPayload = resolveFallbackThinkingDetailsPayload();
    const initialPayload = resolveThinkingDetailsPanelPayload(payload, fallbackPayload);
    const initialMessageItem = initialPayload.messageItem;
    const needsFullDetail =
      initialMessageItem &&
      (initialMessageItem.hasThinkingDetails === true || Number(initialMessageItem.thinkingDetailCount || 0) > 0) &&
      !Array.isArray(initialMessageItem.realtimeLogs);
    let loadedThinkingDetail = null;
    if (needsFullDetail) {
      try {
        loadedThinkingDetail = await fetchThinkingDetailForMessage(initialMessageItem);
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
