/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ref } from "vue";
import {
  getTurnUiState,
  isTurnDetailExpanded,
  setTurnThinkingOpenNames,
  toggleTurnDetailKey,
} from "../runtime/engine/turnUiStore.js";
import { toolLogDetailKey } from "../model/toolLogIdentity.js";
import { selectThinkingDetailCount } from "../model/thinkingDetailCount.js";

export function createThinkingPanelPresentation({
  props,
  emit,
  translate,
  getThinkingDetailForMessage,
  getCanonicalExecutionLogs,
}) {
  const timelineMessage = (messageItem = {}) => messageItem;
  const detailExpansionTick = ref(0);

  function groupExecutionLogs(messageItem = {}) {
    const logs = getCanonicalExecutionLogs(messageItem);
    if (!Array.isArray(logs) || logs.length <= 0) return [];
    return [{ key: "tool-timeline", label: "", items: logs }];
  }

  function collapseThinkingPanel(messageItem = {}) {
    setTurnThinkingOpenNames(messageItem, []);
  }

  function openThinkingDetailDrawer() {
    const detail = getThinkingDetailForMessage(props.messageItem) || {};
    emit("open-thinking-details", {
      messageItem: detail.messageItem || props.messageItem,
    });
  }

  function getThinkingDetailItemKey(
    _groupedToolLogs,
    toolLogItem,
  ) {
    return toolLogDetailKey(toolLogItem);
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
    return selectThinkingDetailCount(timelineMessage(messageItem));
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
    groupExecutionLogs,
    getThinkingDetailCount,
    getThinkingTreePrefix,
    getThinkingDetailItemKey,
    isThinkingDetailExpanded,
    toggleThinkingDetailExpanded,
  };
}
