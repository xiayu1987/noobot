/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ref } from "vue";
import { resolveTimeMs } from "../model/timeFields.js";
import {
  getTurnUiState,
  isTurnDetailExpanded,
  setTurnThinkingOpenNames,
  toggleTurnDetailKey,
} from "../runtime/engine/turnUiStore.js";
import { selectToolTimelineCount } from "../runtime/engine/toolTimeline.js";

export function createThinkingPanelPresentation({
  props,
  emit,
  translate,
  getThinkingDetailForMessage,
  getCompletedToolLogsForMessage,
  getSummaryThinkingDetailCount,
}) {
  const timelineMessage = (messageItem = {}) => messageItem;
  const detailExpansionTick = ref(0);

  function formatInjectedMessageTitle(messageItem = {}, messageIndex = 0) {
    const timeText = String(messageItem?.ts || "").trim();
    const sourceText = String(
      messageItem?.injectedBy || translate("message.injectedSourcePlugin"),
    ).trim();
    return `${messageIndex + 1}. ${sourceText}${timeText ? ` · ${timeText}` : ""}`;
  }

  function groupCompletedToolLogs(messageItem = {}) {
    const toolLogs = getCompletedToolLogsForMessage(messageItem)
      .map((logItem, sourceIndex) => ({ logItem, sourceIndex }))
      .sort((left, right) => {
        const leftTime = resolveTimeMs(left.logItem?.ts);
        const rightTime = resolveTimeMs(right.logItem?.ts);
        if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
          return leftTime - rightTime;
        }
        return left.sourceIndex - right.sourceIndex;
      })
      .map(({ logItem }) => logItem);
    if (toolLogs.length <= 0) return [];
    return [{
      key: "tool-timeline",
      label: "",
      items: toolLogs,
    }];
  }

  function collapseThinkingPanel(messageItem = {}) {
    setTurnThinkingOpenNames(messageItem, []);
  }

  function openThinkingDetailDrawer() {
    const detail = getThinkingDetailForMessage(props.messageItem) || {};
    emit("open-thinking-details", {
      messageItem: detail.messageItem || props.messageItem,
      allMessages: Array.isArray(detail.allMessages) ? detail.allMessages : props.allMessages,
      sessionDocs: Array.isArray(detail.sessionDocs)
        ? detail.sessionDocs
        : Array.isArray(detail.sessions)
          ? detail.sessions
          : props.sessionDocs,
    });
  }

  function getThinkingDetailItemKey(
    _groupedToolLogs,
    toolLogItem,
  ) {
    const eventId = String(toolLogItem?.eventId || "").trim();
    return eventId ? `event:${eventId}` : "";
  }

  function isThinkingDetailExpanded(messageItem = {}, detailItemKey = "") {
    detailExpansionTick.value;
    return isTurnDetailExpanded(messageItem, detailItemKey);
  }

  function toggleThinkingDetailExpanded(messageItem = {}, detailItemKey = "") {
    if (!detailItemKey) return;
    toggleTurnDetailKey(messageItem, detailItemKey);
    detailExpansionTick.value += 1;
  }

  function getThinkingDetailCount(messageItem = {}) {
    const summaryThinkingDetailCount =
      getSummaryThinkingDetailCount(messageItem);
    if (summaryThinkingDetailCount > 0) return summaryThinkingDetailCount;
    const completedToolLogCount =
      getCompletedToolLogsForMessage(messageItem).length;
    if (completedToolLogCount > 0) return completedToolLogCount;
    const toolCalls = Array.isArray(messageItem?.toolCalls)
      ? messageItem.toolCalls
      : Array.isArray(messageItem?.tool_calls)
        ? messageItem.tool_calls
        : [];
    if (toolCalls.length > 0) return toolCalls.length;
    return selectToolTimelineCount(timelineMessage(messageItem));
  }

  function getThinkingDetailLabel(messageItem = {}) {
    return translate("message.thinkingDetails", {
      count: getThinkingDetailCount(messageItem),
    });
  }

  function getThinkingTreePrefix(toolLogItem = {}) {
    const depth = Math.max(1, Number(toolLogItem?.depth || 1));
    if (depth <= 1) return "•";
    return `${"│  ".repeat(Math.max(0, depth - 2))}└─`;
  }

  return {
    getThinkingDetailLabel,
    openThinkingDetailDrawer,
    collapseThinkingPanel,
    groupCompletedToolLogs,
    getThinkingDetailCount,
    getThinkingTreePrefix,
    getThinkingDetailItemKey,
    isThinkingDetailExpanded,
    toggleThinkingDetailExpanded,
    formatInjectedMessageTitle,
  };
}
