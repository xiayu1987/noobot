<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, watch } from "vue";
import { useLocale } from "../i18n/useLocale";
import { useThinkingPanel } from "./useThinkingPanel";
import { normalizeTurnScopeIdKey } from "../../composables/infra/messageIdentity";
import { getTurnUiState, setTurnThinkingOpenNames } from "../../composables/chat/chatEngine/turnUiStore";
import ThinkingPanelRealtime from "./ThinkingPanelRealtime.vue";
import ThinkingPanelDetails from "./ThinkingPanelDetails.vue";

const props = defineProps({
  messageItem: { type: Object, default: () => ({}) },
  allMessages: { type: Array, default: () => [] },
  sessionDocs: { type: Array, default: () => [] },
  runtime: { type: Object, default: null },
  variant: { type: String, default: "panel" },
  userId: { type: String, default: "" },
  authFetch: { type: Function, default: null },
  renderMarkdown: { type: Function, default: null },
  formatTime: { type: Function, default: null },
  formatFileSize: { type: Function, default: null },
  isImageMime: { type: Function, default: null },
});
const emit = defineEmits(["open-thinking-details"]);
const { translate } = useLocale();
const panel = useThinkingPanel(props, emit);
const thinkingOpenNames = computed(() => getTurnUiState(props.messageItem)?.thinkingOpenNames || []);
const thinkingIdentity = computed(() => [
  String(props.messageItem?.sessionId || "").trim(),
  normalizeTurnScopeIdKey(props.messageItem?.turnScopeId),
  String(props.messageItem?.dialogProcessId || props.messageItem?.id || props.messageItem?.messageId || "").trim(),
].join("::"));
watch(thinkingIdentity, () => {
  getTurnUiState(props.messageItem);
});
function updateThinkingOpenNames(value) {
  setTurnThinkingOpenNames(props.messageItem, value);
}
const {
  injectedMessages,
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
  formatInjectedMessageTitle,
} = panel;
// A turn can be represented by several incremental assistant messages. The
// thinking card plugin is mounted for each of them, but the live workflow must
// belong to one card only. Use the last message with the same turn identity as
// the owner so streaming snapshots cannot split the thinking UI into cards.
const ownsWorkflowProjection = computed(() => {
  if (props.variant === "details" || !hasThinking.value) return false;
  const turnScopeId = String(props.messageItem?.turnScopeId || "").trim();
  const dialogProcessId = String(props.messageItem?.dialogProcessId || "").trim();
  if (!turnScopeId && !dialogProcessId) return false;
  const matchingMessages = (Array.isArray(props.allMessages) ? props.allMessages : [])
    .filter((item = {}) => {
      if (item?.role !== "assistant" || item?.__workflowLiveProjection === true) return false;
      if (turnScopeId) return String(item?.turnScopeId || "").trim() === turnScopeId;
      return String(item?.dialogProcessId || "").trim() === dialogProcessId;
    });
  return matchingMessages.at(-1) === props.messageItem;
});

const workflowProjectionProps = computed(() => ({
  activeSession: { messages: props.allMessages },
  anchorMessage: props.messageItem,
  messageItemSharedProps: {
    userId: props.userId,
    authFetch: props.authFetch,
    renderMarkdown: props.renderMarkdown,
    formatTime: props.formatTime,
    formatFileSize: props.formatFileSize,
    isImageMime: props.isImageMime,
  },
}));
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
    :show-workflow-projection="ownsWorkflowProjection"
    :workflow-projection-props="workflowProjectionProps"
    :open-names="thinkingOpenNames"
    @update:open-names="updateThinkingOpenNames"
    @open-thinking-details="openThinkingDetailDrawer"
    @collapse="updateThinkingOpenNames([])"
  />
  <ThinkingPanelDetails
    v-else-if="hasThinking || loadedThinkingDetail"
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
