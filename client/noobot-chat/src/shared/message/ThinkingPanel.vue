<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { useLocale } from "../i18n/useLocale";
import { useThinkingPanel } from "./useThinkingPanel";
import ThinkingPanelRealtime from "./ThinkingPanelRealtime.vue";
import ThinkingPanelDetails from "./ThinkingPanelDetails.vue";

const props = defineProps({
  messageItem: { type: Object, default: () => ({}) },
  allMessages: { type: Array, default: () => [] },
  variant: { type: String, default: "panel" },
});
const emit = defineEmits(["open-thinking-details"]);
const { translate } = useLocale();
const panel = useThinkingPanel(props, emit);
const {
  injectedMessages,
  hasThinking,
  thinkingDurationLabel,
  isThinkingRuntimeRunning,
  getLatestPluginAnalysisLog,
  getLatestMainModelContentLog,
  getExecutionLogs,
  getExecutionLogCount,
  getThinkingDetailLabel,
  openThinkingDetailDrawer,
  collapseThinkingPanel,
  isMessageRuntimeRunning,
  groupCompletedToolLogs,
  getThinkingDetailCount,
  getThinkingTreePrefix,
  getThinkingDetailItemKey,
  isThinkingDetailExpanded,
  toggleThinkingDetailExpanded,
  formatInjectedMessageTitle,
} = panel;
</script>

<template>
  <ThinkingPanelRealtime
    v-if="variant !== 'details' && hasThinking"
    :message-item="messageItem"
    :translate="translate"
    :thinking-duration-label="thinkingDurationLabel"
    :is-running="isThinkingRuntimeRunning(messageItem)"
    :latest-plugin-analysis-log="getLatestPluginAnalysisLog(messageItem)"
    :latest-main-model-content-log="getLatestMainModelContentLog(messageItem)"
    :execution-logs="getExecutionLogs(messageItem)"
    :execution-log-count="getExecutionLogCount(messageItem)"
    :thinking-detail-label="getThinkingDetailLabel(messageItem)"
    @open-thinking-details="openThinkingDetailDrawer"
    @collapse="collapseThinkingPanel(messageItem)"
  />
  <ThinkingPanelDetails
    v-else-if="hasThinking"
    :message-item="messageItem"
    :translate="translate"
    :is-running="isMessageRuntimeRunning(messageItem)"
    :detail-label="getThinkingDetailLabel(messageItem)"
    :grouped-tool-logs="groupCompletedToolLogs(messageItem)"
    :injected-messages="injectedMessages"
    :detail-count="getThinkingDetailCount(messageItem)"
    :get-tree-prefix="getThinkingTreePrefix"
    :get-detail-key="getThinkingDetailItemKey"
    :is-expanded="isThinkingDetailExpanded"
    :toggle-expanded="toggleThinkingDetailExpanded"
    :format-injected-title="formatInjectedMessageTitle"
  />
  <template v-else></template>
</template>
