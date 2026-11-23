/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isRef, ref, shallowRef, watch } from "vue";
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
  getMessageSessionId,
} from "../../modules/chat/model/messageIdentity.js";
import { selectToolTimelineCount } from "../../modules/chat/runtime/engine/toolTimeline.js";
import { selectThinkingDetailCount } from "../../modules/chat/model/thinkingDetailCount.js";
import { selectActivityTimelineLogs } from "../../modules/chat/runtime/engine/activityTimeline.js";
import { selectThinkingDetailContentTimeline } from "@noobot/event-protocol/thinking-detail-content";
import { logThinkingReplayDebug } from "../../modules/debug/loggers/thinkingReplayDebugLogger.js";
import { logStateMachineDebug } from "../../modules/debug/loggers/stateMachineLogger.js";
import { isFunction, requireFunctionDependencies, text } from "@noobot/shared/value";

function hasCanonicalTimeline(messageItem = {}) {
  return (
    selectToolTimelineCount(messageItem) > 0 ||
    selectActivityTimelineLogs(messageItem).length > 0 ||
    selectThinkingDetailContentTimeline(messageItem).length > 0
  );
}

function isSameThinkingTurn(left = {}, right = {}) {
  if (getMessageRole(left) !== "assistant" || getMessageRole(right) !== "assistant") return false;
  const leftPresentationMessageId = text(left?.presentationMessageId);
  const rightPresentationMessageId = text(right?.presentationMessageId);
  return Boolean(
    leftPresentationMessageId && leftPresentationMessageId === rightPresentationMessageId,
  );
}

function summarizeThinkingTimeline(messageItem = {}) {
  const toolTimeline = Array.isArray(messageItem?.toolTimeline) ? messageItem.toolTimeline : [];
  return {
    presentationMessageId: text(messageItem?.presentationMessageId),
    dialogProcessId: getMessageDialogProcessId(messageItem),
    turnScopeId: getMessageTurnScopeId(messageItem),
    pending: messageItem?.pending === true,
    hasThinkingDetails: messageItem?.hasThinkingDetails === true,
    thinkingDetailCount: selectThinkingDetailCount(messageItem),
    activityTimelineCount: selectActivityTimelineLogs(messageItem).length,
    thinkingContentCount: selectThinkingDetailContentTimeline(messageItem).length,
    toolTimelineCount: selectToolTimelineCount(messageItem),
    toolTimelineDetailCount: toolTimeline.filter(
      (entry = {}) => entry?.args !== undefined || entry?.result !== undefined,
    ).length,
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
  const thinkingContents = selectThinkingDetailContentTimeline(messageItem);
  const lastThinkingContent = thinkingContents.at(-1) || {};
  return [
    messageItem.messageEventState?.lastSequence,
    tools.length,
    lastTool?.resultEvent?.eventId || lastTool?.call?.eventId || "",
    activities.length,
    lastActivity?.eventId || "",
    thinkingContents.length,
    lastThinkingContent?.contentId || "",
  ].join(":");
}

export function useThinkingDetailsPanel({
  activeSession,
  activeSessionId,
  fetchThinkingDetail,
  releaseThinkingDetail,
  notify,
  translate,
  closeAllDrawers,
  closeMobileSidebar,
  closeComposerMorePanel,
  pushPseudoRoute,
  thinkingDetailsPanel,
}) {
  requireFunctionDependencies("useThinkingDetailsPanel", {
    fetchThinkingDetail,
    releaseThinkingDetail,
    notify,
    translate,
    closeAllDrawers,
    closeMobileSidebar,
    closeComposerMorePanel,
    pushPseudoRoute,
  });
  if (!isRef(activeSession) || !isRef(activeSessionId)) {
    throw new TypeError("useThinkingDetailsPanel requires activeSession and activeSessionId refs");
  }
  const thinkingDetailsVisible = ref(false);
  const thinkingDetailsMessageItem = ref(null);
  const thinkingDetailsAllMessages = ref([]);
  const thinkingDetailsFetcher = shallowRef(null);
  const thinkingDetailsReleaser = shallowRef(null);

  function resolveFallbackThinkingDetailsPayload() {
    return resolveFallbackThinkingDetailsPayloadState(activeSession.value);
  }

  function closeThinkingDetailsPanel() {
    thinkingDetailsVisible.value = false;
    thinkingDetailsMessageItem.value = null;
    thinkingDetailsAllMessages.value = [];
    thinkingDetailsFetcher.value = null;
    thinkingDetailsReleaser.value = null;
  }

  function getThinkingDetailsTitle(messageItem) {
    return getThinkingDetailsTitleState(messageItem, translate);
  }

  function findActiveCanonicalMessage(messageItem = {}) {
    const session = activeSession.value;
    if (session === null) return null;
    return (
      session.messages.find((candidate = {}) => isSameThinkingTurn(messageItem, candidate)) || null
    );
  }

  function getLiveSessionMessages() {
    const session = activeSession.value;
    return session === null ? [] : session.messages;
  }

  function buildDetailWatchKey() {
    if (!thinkingDetailsVisible.value) return "";
    const messageItem = thinkingDetailsMessageItem.value || {};
    const sourceMessage = findActiveCanonicalMessage(messageItem);
    const sourceKey =
      sourceMessage === null
        ? ["detached"]
        : [sourceMessage.pending === true ? "pending" : "done", timelineRevision(sourceMessage)];
    return [
      getMessageSessionId(messageItem),
      getMessageDialogProcessId(messageItem),
      getMessageTurnScopeId(messageItem),
      ...sourceKey,
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
    const injectedReader = isFunction(payload?.fetchThinkingDetail);
    const pageReader = injectedReader ? payload.fetchThinkingDetail : fetchThinkingDetail;
    const pageReleaser = injectedReader ? payload.releaseThinkingDetail : releaseThinkingDetail;
    requireFunctionDependencies("thinking detail page reader", {
      fetchThinkingDetail: pageReader,
      releaseThinkingDetail: pageReleaser,
    });
    logThinkingPanelState("frontend.thinkingReplay.detailPanelOpenResolved", () => ({
      sessionId: activeSessionId.value,
      payload: summarizeThinkingTimeline(payloadMessageItem),
      active: summarizeThinkingTimeline(activeMessageItem || {}),
      selectedSource: activeMessageItem ? "active-session" : "payload",
      hasLocalThinkingDetails,
    }));
    const usesLiveSession = initialMessageItem?.pending === true;
    closeAllDrawers();
    closeMobileSidebar();
    closeComposerMorePanel();
    thinkingDetailsFetcher.value = pageReader;
    thinkingDetailsReleaser.value = pageReleaser;
    thinkingDetailsMessageItem.value = initialMessageItem;
    thinkingDetailsAllMessages.value = usesLiveSession ? getLiveSessionMessages() : [];
    thinkingDetailsVisible.value = true;
    if (payload?.pushRoute !== false) {
      pushPseudoRoute(buildThinkingDetailsRoute(activeSessionId.value, thinkingDetailsPanel));
    }
  }

  watch(
    [
      buildDetailWatchKey,
      () =>
        thinkingDetailsVisible.value
          ? findActiveCanonicalMessage(thinkingDetailsMessageItem.value)
          : null,
    ],
    () => {
      if (!thinkingDetailsVisible.value) return;
      const currentMessage = thinkingDetailsMessageItem.value;
      const sourceMessage = findActiveCanonicalMessage(currentMessage);
      if (sourceMessage?.pending === true) {
        thinkingDetailsMessageItem.value = sourceMessage;
        thinkingDetailsAllMessages.value = getLiveSessionMessages();
        logThinkingPanelState("frontend.thinkingReplay.detailPanelCanonicalSynchronized", () => ({
          sessionId: activeSessionId.value,
          source: summarizeThinkingTimeline(sourceMessage),
          liveAllMessageCount: thinkingDetailsAllMessages.value.length,
          liveInjectedMessageCount: thinkingDetailsAllMessages.value.filter(
            (item = {}) => item?.injectedMessage === true,
          ).length,
        }));
        return;
      }
      if (sourceMessage !== null) thinkingDetailsMessageItem.value = sourceMessage;
      thinkingDetailsAllMessages.value = [];
    },
  );

  return {
    thinkingDetailsVisible,
    thinkingDetailsFetcher,
    thinkingDetailsReleaser,
    thinkingDetailsMessageItem,
    thinkingDetailsAllMessages,
    closeThinkingDetailsPanel,
    getThinkingDetailsTitle,
    openThinkingDetailsPanel,
  };
}
