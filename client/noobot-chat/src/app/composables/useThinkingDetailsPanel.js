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
import {
  getCachedThinkingDetail,
  loadThinkingDetail,
  resolveThinkingDetailIdentity,
} from "../../modules/chat/model/thinkingDetailCache.js";
import { selectToolTimelineCount } from "../../modules/chat/runtime/engine/toolTimeline.js";
import { selectActivityTimelineLogs } from "../../modules/chat/runtime/engine/activityTimeline.js";
import { logThinkingReplayDebug } from "../../modules/debug/loggers/thinkingReplayDebugLogger.js";
import { logStateMachineDebug } from "../../modules/debug/loggers/stateMachineLogger.js";

function hasCanonicalTimeline(messageItem = {}) {
  return selectToolTimelineCount(messageItem) > 0 ||
    selectActivityTimelineLogs(messageItem).length > 0;
}

function isSameThinkingTurn(left = {}, right = {}) {
  if (getMessageRole(left) !== "assistant" || getMessageRole(right) !== "assistant") return false;
  const leftPresentationMessageId = String(left?.presentationMessageId || "").trim();
  const rightPresentationMessageId = String(right?.presentationMessageId || "").trim();
  return Boolean(
    leftPresentationMessageId &&
    leftPresentationMessageId === rightPresentationMessageId
  );
}

function summarizeThinkingTimeline(messageItem = {}) {
  const toolTimeline = Array.isArray(messageItem?.toolTimeline) ? messageItem.toolTimeline : [];
  return {
    presentationMessageId: String(messageItem?.presentationMessageId || "").trim(),
    dialogProcessId: getMessageDialogProcessId(messageItem),
    turnScopeId: getMessageTurnScopeId(messageItem),
    pending: messageItem?.pending === true,
    hasThinkingDetails: messageItem?.hasThinkingDetails === true,
    thinkingDetailCount: Number(messageItem?.thinkingDetailCount || 0),
    activityTimelineCount: selectActivityTimelineLogs(messageItem).length,
    toolTimelineCount: selectToolTimelineCount(messageItem),
    toolTimelineDetailCount: toolTimeline.filter((entry = {}) => (
      entry?.args !== undefined || entry?.result !== undefined
    )).length,
  };
}

function logThinkingPanelState(event, payload = {}) {
  logThinkingReplayDebug(event, payload);
  logStateMachineDebug(event, payload);
}

function timelineRevision(messageItem = {}) {
  const tools = Array.isArray(messageItem?.toolTimeline) ? messageItem.toolTimeline : [];
  const activities = selectActivityTimelineLogs(messageItem);
  const lastTool = tools.at(-1) || {};
  const lastActivity = activities.at(-1) || {};
  return [
    Number(messageItem?.messageEventState?.lastSequence || 0),
    tools.length,
    lastTool?.resultEvent?.eventId || lastTool?.call?.eventId || "",
    activities.length,
    lastActivity?.eventId || lastActivity?.activityId || "",
  ].join(":");
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
    thinkingDetailsMessageItem.value = null;
    thinkingDetailsAllMessages.value = [];
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

  function expectedThinkingDetailRevision(messageItem = {}) {
    return String(messageItem?.thinkingDetailRef?.contentHash || "").trim();
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
      expectedRevision: expectedThinkingDetailRevision(messageItem),
    });
  }

  function findActiveCanonicalMessage(messageItem = {}) {
    return (activeSession?.value?.messages || [])
      .find((candidate = {}) => isSameThinkingTurn(messageItem, candidate)) || null;
  }

  function getLiveSessionMessages() {
    return Array.isArray(activeSession?.value?.messages)
      ? activeSession.value.messages
      : [];
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
    logThinkingPanelState("frontend.thinkingReplay.detailPanelOpenResolved", () => ({
      sessionId: activeSessionId?.value,
      payload: summarizeThinkingTimeline(payloadMessageItem),
      active: summarizeThinkingTimeline(activeMessageItem || {}),
      selectedSource: activeMessageItem ? "active-session" : "payload",
      hasLocalThinkingDetails,
    }));
    const usesLiveSession = initialMessageItem?.pending === true;
    const needsFullDetail = Boolean(initialMessageItem && !usesLiveSession);
    const cachedIdentity = resolveThinkingDetailIdentity(
      initialMessageItem,
      activeSessionId?.value,
    );
    const expectedRevision = expectedThinkingDetailRevision(initialMessageItem);
    const cachedCandidate = getCachedThinkingDetail(cachedIdentity);
    const cachedThinkingDetail = expectedRevision &&
      String(cachedCandidate?.revision || "").trim() === expectedRevision
      ? cachedCandidate
      : null;
    const initialDetailMessage = cachedThinkingDetail?.messageItem || initialMessageItem;
    closeAllDrawers?.();
    closeMobileSidebar?.();
    closeComposerMorePanel?.();
    thinkingDetailsMessageItem.value = initialDetailMessage;
    thinkingDetailsAllMessages.value = usesLiveSession ? getLiveSessionMessages() : [];
    thinkingDetailsVisible.value = true;
    detailWatchSkipKey = buildDetailWatchKey();
    if (payload?.pushRoute !== false) {
      pushPseudoRoute?.(buildThinkingDetailsRoute(activeSessionId?.value, thinkingDetailsPanel));
    }
    let loadedThinkingDetail = null;
    if (needsFullDetail) {
      try {
        loadedThinkingDetail = await fetchThinkingDetailForMessage(initialMessageItem, requestFetchDetail);
        if (openRequestVersion !== detailRequestVersion) return;
        logThinkingPanelState("frontend.thinkingReplay.detailPanelRequestCommitted", () => ({
          sessionId: activeSessionId?.value,
          requested: summarizeThinkingTimeline(initialMessageItem),
          detail: summarizeThinkingTimeline(loadedThinkingDetail?.messageItem || {}),
          injectedMessageCount: Number(loadedThinkingDetail?.counts?.injectedMessageCount || 0),
        }));
      } catch (error) {
        if (openRequestVersion !== detailRequestVersion) return;
        notify?.({ type: "warning", message: error?.message || translate?.("chat.loadSessionDetailFailed") });
        return;
      }
      if (!loadedThinkingDetail?.messageItem) return;
    }
    if (loadedThinkingDetail?.messageItem) {
      thinkingDetailsMessageItem.value = loadedThinkingDetail.messageItem;
      thinkingDetailsAllMessages.value = [];
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
      if (sourceMessage?.pending === true) {
        detailRequestVersion += 1;
        thinkingDetailsMessageItem.value = sourceMessage;
        thinkingDetailsAllMessages.value = getLiveSessionMessages();
        logThinkingPanelState("frontend.thinkingReplay.detailPanelCanonicalSynchronized", () => ({
          sessionId: activeSessionId?.value,
          source: summarizeThinkingTimeline(sourceMessage),
          liveAllMessageCount: thinkingDetailsAllMessages.value.length,
          liveInjectedMessageCount: thinkingDetailsAllMessages.value
            .filter((item = {}) => item?.injectedMessage === true).length,
        }));
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
        thinkingDetailsAllMessages.value = [];
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
