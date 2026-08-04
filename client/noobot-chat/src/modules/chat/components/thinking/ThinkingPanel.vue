<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, watch } from "vue";
import { useLocale } from "../../../../shared/i18n/useLocale.js";
import { useThinkingPanel } from "../../composables/useThinkingPanel.js";
import { normalizeTurnScopeIdKey } from "../../model/messageIdentity.js";
import { getTurnUiState, setTurnThinkingOpenNames } from "../../runtime/engine/turnUiStore.js";
import ThinkingPanelRealtime from "./ThinkingPanelRealtime.vue";
import ThinkingPanelDetails from "./ThinkingPanelDetails.vue";

const props = defineProps({
  messageItem: { type: Object, default: () => ({}) },
  allMessages: { type: Array, default: () => [] },
  sessionDocs: { type: Array, default: () => [] },
  runtime: { type: Object, default: null },
  variant: { type: String, default: "panel" },
  userId: { type: String, default: "" },
  thinkingDetailService: { type: Object, default: null },
  renderMarkdown: { type: Function, default: null },
  formatTime: { type: Function, default: null },
  formatFileSize: { type: Function, default: null },
  isImageMime: { type: Function, default: null },
});
const emit = defineEmits(["open-thinking-details", "panel-visibility-change"]);
const { translate } = useLocale();
const thinkingOpenNames = computed(() => getTurnUiState(props.messageItem)?.thinkingOpenNames || []);
const shouldLoadThinkingDetail = () =>
  String(props.variant || "panel") === "details" ||
  thinkingOpenNames.value.includes("thinking-panel");
const panel = useThinkingPanel(props, emit, { shouldLoadThinkingDetail });
const thinkingIdentity = computed(() => [
  String(props.messageItem?.sessionId || "").trim(),
  normalizeTurnScopeIdKey(props.messageItem?.turnScopeId),
  String(props.messageItem?.dialogProcessId || props.messageItem?.id || props.messageItem?.messageId || "").trim(),
].join("::"));
const panelVisible = computed(() => Boolean(panel.hasThinking.value || panel.loadedThinkingDetail.value));
watch(panelVisible, (visible) => emit("panel-visibility-change", visible), { immediate: true });
watch(thinkingIdentity, () => {
  if (props.messageItem?.role !== "assistant") return;
  getTurnUiState(props.messageItem);
});
function updateThinkingOpenNames(value) {
  setTurnThinkingOpenNames(props.messageItem, value);
}
const {
  thinkingContentItems,
  hasThinking,
  getThinkingDurationLabel,
  isThinkingRuntimeRunning,
  getLatestPluginAnalysisLog,
  getLatestMainModelContentLog,
  getExecutionLogs,
  currentExecutionLogs,
  loadedThinkingDetail,
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
} = panel;
</script>

<template>
  <ThinkingPanelRealtime
    v-if="variant !== 'details' && (hasThinking || loadedThinkingDetail)"
    :message-item="messageItem"
    :translate="translate"
    :thinking-duration-label="getThinkingDurationLabel()"
    :is-running="isThinkingRuntimeRunning(messageItem)"
    :latest-plugin-analysis-log="getLatestPluginAnalysisLog(messageItem)"
    :latest-main-model-content-log="getLatestMainModelContentLog(messageItem)"
    :execution-logs="currentExecutionLogs"
    :execution-log-count="getExecutionLogCount(messageItem)"
    :thinking-detail-label="getThinkingDetailLabel(messageItem)"
    :open-names="thinkingOpenNames"
    :get-detail-key="getThinkingDetailItemKey"
    :is-expanded="isThinkingDetailExpanded"
    :toggle-expanded="toggleThinkingDetailExpanded"
    @update:open-names="updateThinkingOpenNames"
    @open-thinking-details="openThinkingDetailDrawer"
    @collapse="updateThinkingOpenNames([])"
  />
  <ThinkingPanelDetails
    v-else-if="hasThinking || loadedThinkingDetail"
    :message-item="messageItem"
    :translate="translate"
    :is-running="isMessageRuntimeRunning(messageItem)"
    :grouped-tool-logs="groupCompletedToolLogs(messageItem)"
    :thinking-content-items="thinkingContentItems"
    :detail-count="getExecutionLogCount(messageItem)"
    :get-tree-prefix="getThinkingTreePrefix"
    :get-detail-key="getThinkingDetailItemKey"
    :is-expanded="isThinkingDetailExpanded"
    :toggle-expanded="toggleThinkingDetailExpanded"
  />
  <template v-else></template>
</template>
