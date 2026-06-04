<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useLocale } from "../../shared/i18n/useLocale";
import { isHarnessInjectedMessage } from "../../composables/infra/messageModel";

const props = defineProps({
  messageItem: { type: Object, default: () => ({}) },
  allMessages: { type: Array, default: () => [] },
});

const injectedMessages = computed(() => getInjectedMessagesForMessage(props.messageItem));
const hasThinking = computed(
  () => hasThinkingLogs(props.messageItem) || injectedMessages.value.length > 0,
);
const { translate } = useLocale();
const nowTick = ref(Date.now());
const detailExpansionTick = ref(0);
let timer = null;

function getRealtimeLogs(messageItem = {}) {
  return (messageItem.realtimeLogs || []).slice(-10);
}

function getAllRealtimeLogs(messageItem = {}) {
  return Array.isArray(messageItem?.realtimeLogs) ? messageItem.realtimeLogs : [];
}

function hasThinkingLogs(messageItem = {}) {
  if (!messageItem || messageItem.role !== "assistant") return false;
  if (messageItem.pending) return true;
  const hasRealtimeLogs = Array.isArray(messageItem.realtimeLogs)
    ? messageItem.realtimeLogs.length > 0
    : false;
  if (hasRealtimeLogs) return true;
  return getCompletedToolLogsForMessage(messageItem).length > 0;
}


function getInjectedMessagesForMessage(messageItem = {}) {
  if (!messageItem || messageItem.role !== "assistant") return [];
  const dialogProcessId = String(messageItem?.dialogProcessId || "").trim();
  const candidateMessages = Array.isArray(props.allMessages) ? props.allMessages : [];
  return candidateMessages.filter((item = {}) => {
    if (!isHarnessInjectedMessage(item)) return false;
    if (!dialogProcessId) return true;
    return String(item?.dialogProcessId || "").trim() === dialogProcessId;
  });
}

function getScopedMessagesForMessage(messageItem = {}) {
  const dialogProcessId = String(messageItem?.dialogProcessId || "").trim();
  const candidateMessages = Array.isArray(props.allMessages) ? props.allMessages : [];
  if (!dialogProcessId) return candidateMessages;
  return candidateMessages.filter(
    (item = {}) => String(item?.dialogProcessId || "").trim() === dialogProcessId,
  );
}

function isToolRelatedMessage(messageItem = {}) {
  const role = String(messageItem?.role || "").trim().toLowerCase();
  const type = String(messageItem?.type || "").trim().toLowerCase();
  const toolCalls = Array.isArray(messageItem?.tool_calls) ? messageItem.tool_calls : [];
  if (toolCalls.length > 0) return true;
  if (role === "tool") return true;
  if (type === "tool_call" || type === "tool_result") return true;
  return false;
}

function stringifyJson(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildToolCallText(toolCall = {}, fallbackIndex = 0) {
  const toolName = String(
    toolCall?.function?.name || toolCall?.name || `tool_${fallbackIndex + 1}`,
  ).trim();
  const argsText = stringifyJson(toolCall?.function?.arguments ?? toolCall?.args ?? "");
  const normalizedArgs = String(argsText || "").trim();
  if (!normalizedArgs) return toolName;
  const shortArgs =
    normalizedArgs.length > 180 ? `${normalizedArgs.slice(0, 180)}...` : normalizedArgs;
  return `${toolName}(${shortArgs})`;
}

function buildToolResultText(messageItem = {}) {
  const contentText = String(messageItem?.content || "").trim();
  if (!contentText) return "tool_result";
  try {
    const parsed = JSON.parse(contentText);
    const toolName = String(parsed?.toolName || parsed?.name || "").trim();
    const status = String(parsed?.status || "").trim();
    const okText = typeof parsed?.ok === "boolean" ? `ok=${parsed.ok}` : "";
    return [toolName || "tool_result", status, okText].filter(Boolean).join(" ");
  } catch {
    const shortText = contentText.length > 180 ? `${contentText.slice(0, 180)}...` : contentText;
    return shortText;
  }
}

function buildFallbackCompletedToolLogs(messageItem = {}) {
  const scopedMessages = getScopedMessagesForMessage(messageItem);
  const fallbackToolLogs = [];
  for (const item of scopedMessages) {
    if (!isToolRelatedMessage(item)) continue;
    const sessionId = String(item?.sessionId || messageItem?.sessionId || "");
    const dialogProcessId = String(
      item?.dialogProcessId || messageItem?.dialogProcessId || "",
    ).trim();
    const timestamp = item?.ts || messageItem?.ts || "";
    const itemType = String(item?.type || "").trim().toLowerCase();
    const itemRole = String(item?.role || "").trim().toLowerCase();
    const itemToolCalls = Array.isArray(item?.tool_calls) ? item.tool_calls : [];

    if (itemToolCalls.length > 0 || itemType === "tool_call") {
      const toolCalls = itemToolCalls.length > 0 ? itemToolCalls : [{}];
      toolCalls.forEach((toolCall, toolCallIndex) => {
        fallbackToolLogs.push({
          sessionId,
          depth: 1,
          dialogProcessId,
          type: "tool_call",
          event: "tool_call",
          text: buildToolCallText(toolCall, toolCallIndex),
          ts: timestamp,
        });
      });
      continue;
    }

    if (itemRole === "tool" || itemType === "tool_result") {
      fallbackToolLogs.push({
        sessionId,
        depth: 1,
        dialogProcessId,
        type: "tool_result",
        event: "tool_result",
        text: buildToolResultText(item),
        ts: timestamp,
      });
    }
  }
  return fallbackToolLogs;
}

function getCompletedToolLogsForMessage(messageItem = {}) {
  const completedToolLogs = Array.isArray(messageItem?.completedToolLogs)
    ? messageItem.completedToolLogs
    : [];
  if (completedToolLogs.length > 0) return completedToolLogs;
  return buildFallbackCompletedToolLogs(messageItem);
}

function getInjectedMessageCount() {
  return injectedMessages.value.length;
}

function formatInjectedMessageTitle(messageItem = {}, messageIndex = 0) {
  const timeText = String(messageItem?.ts || "").trim();
  const sourceText = String(messageItem?.injectedBy || "harness-plugin").trim();
  return `${messageIndex + 1}. ${sourceText}${timeText ? ` · ${timeText}` : ""}`;
}

function formatSessionGroupLabel(
  sessionId = "",
  depth = 0,
  dialogProcessId = "",
) {
  const shortSessionId = String(sessionId || "").slice(0, 8) || "unknown";
  const shortDialogProcessId =
    String(dialogProcessId || "").slice(0, 8) || "unknown";
  const levelText = translate("message.depthLabel", { depth: Math.max(1, Number(depth || 1)) });
  if (Number(depth || 0) <= 1) {
    return translate("message.mainTaskGroup", {
      sessionId: shortSessionId,
      dialogId: shortDialogProcessId,
      level: levelText,
    });
  }
  return translate("message.subTaskGroup", {
    sessionId: shortSessionId,
    dialogId: shortDialogProcessId,
    level: levelText,
  });
}

function groupCompletedToolLogs(messageItem = {}) {
  const toolLogs = getCompletedToolLogsForMessage(messageItem);
  const groupedMap = new Map();
  const groupedList = [];

  for (const logItem of toolLogs) {
    const sessionId = String(logItem?.sessionId || "");
    const depth = Number(logItem?.depth || 0);
    const dialogProcessId = String(logItem?.dialogProcessId || "");
    const groupKey = `${sessionId}|${depth}|${dialogProcessId}`;
    let group = groupedMap.get(groupKey);
    if (!group) {
      group = {
        key: groupKey,
        sessionId,
        depth,
        label: formatSessionGroupLabel(sessionId, depth, dialogProcessId),
        items: [],
      };
      groupedMap.set(groupKey, group);
      groupedList.push(group);
    }
    group.items.push(logItem);
  }

  return groupedList;
}

function collapseThinkingPanel(messageItem = {}) {
  messageItem.thinkingOpenNames = [];
}

function getThinkingDetailItemKey(groupedToolLogs, toolLogItem, toolLogIndex) {
  return `${String(groupedToolLogs?.key || "")}|${toolLogIndex}|${String(toolLogItem?.ts || "")}|${String(toolLogItem?.event || "")}`;
}

function isThinkingDetailExpanded(messageItem = {}, detailItemKey = "") {
  // Some callers (workflow node drawer) pass computed/plain message objects,
  // not Pinia/reactive store objects. Track this tick so click-to-expand still
  // forces a render after mutating expandedDetailLogKeys.
  detailExpansionTick.value;
  return Array.isArray(messageItem?.expandedDetailLogKeys)
    ? messageItem.expandedDetailLogKeys.includes(detailItemKey)
    : false;
}

function toggleThinkingDetailExpanded(messageItem = {}, detailItemKey = "") {
  if (!detailItemKey) return;
  const currentKeys = Array.isArray(messageItem?.expandedDetailLogKeys)
    ? messageItem.expandedDetailLogKeys
    : [];
  if (currentKeys.includes(detailItemKey)) {
    messageItem.expandedDetailLogKeys = currentKeys.filter(
      (itemKey) => itemKey !== detailItemKey,
    );
    detailExpansionTick.value += 1;
    return;
  }
  messageItem.expandedDetailLogKeys = [...currentKeys, detailItemKey];
  detailExpansionTick.value += 1;
}

function getExecutionLogCount(messageItem = {}) {
  return Math.max(
    Number(messageItem?.executionLogTotal || 0),
    getAllRealtimeLogs(messageItem).length,
  );
}

function getExecutionLogs(messageItem = {}) {
  return getRealtimeLogs(messageItem);
}

function getThinkingDetailCount(messageItem = {}) {
  return getCompletedToolLogsForMessage(messageItem).length;
}

function getThinkingTreePrefix(toolLogItem = {}) {
  const depth = Math.max(1, Number(toolLogItem?.depth || 1));
  if (depth <= 1) return "•";
  return `${"│  ".repeat(Math.max(0, depth - 2))}└─`;
}

function parseTimeMs(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") {
    return value > 1e11 ? value : value * 1000;
  }
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    return asNumber > 1e11 ? asNumber : asNumber * 1000;
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDuration(ms = 0) {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const hourValue = Math.floor(total / 3600);
  const minuteValue = Math.floor((total % 3600) / 60);
  const secondValue = total % 60;
  if (hourValue > 0) {
    return `${String(hourValue).padStart(2, "0")}:${String(minuteValue).padStart(2, "0")}:${String(secondValue).padStart(2, "0")}`;
  }
  return `${String(minuteValue).padStart(2, "0")}:${String(secondValue).padStart(2, "0")}`;
}

function getThinkingDurationMs(messageItem = {}) {
  const dialogProcessId = String(messageItem?.dialogProcessId || "").trim();
  const candidateMessages = Array.isArray(props.allMessages)
    ? props.allMessages
    : [];
  const scopedMessages = dialogProcessId
    ? candidateMessages.filter(
        (item) =>
          String(item?.dialogProcessId || "").trim() === dialogProcessId,
      )
    : candidateMessages;
  const scopedTimes = scopedMessages
    .map((item) => parseTimeMs(item?.ts))
    .filter((timeValue) => timeValue > 0);
  if (scopedTimes.length >= 2) {
    const startMs = Math.min(...scopedTimes);
    const endMs = messageItem?.pending
      ? Math.max(nowTick.value, ...scopedTimes)
      : Math.max(...scopedTimes);
    return Math.max(0, endMs - startMs);
  }

  const msgTs = parseTimeMs(messageItem?.ts);
  const startedAt = parseTimeMs(messageItem?.thinkingStartedAt);
  const finishedAt = parseTimeMs(messageItem?.thinkingFinishedAt);
  const realtimeLogs = getAllRealtimeLogs(messageItem);
  const completedToolLogs = getCompletedToolLogsForMessage(messageItem);
  const logTimes = [...realtimeLogs, ...completedToolLogs]
    .map((logItem) => parseTimeMs(logItem?.ts))
    .filter((timeValue) => timeValue > 0);
  const startCandidates = [
    startedAt,
    ...(logTimes.length ? [Math.min(...logTimes)] : []),
    msgTs,
  ].filter((timeValue) => timeValue > 0);
  if (!startCandidates.length) return 0;
  const startMs = Math.min(...startCandidates);
  const endMs = messageItem?.pending
    ? nowTick.value
    : Math.max(
        startMs,
        finishedAt,
        ...(logTimes.length ? [Math.max(...logTimes)] : []),
        msgTs,
      );
  return Math.max(0, endMs - startMs);
}

function getThinkingDurationLabel(messageItem = {}) {
  return formatDuration(getThinkingDurationMs(messageItem));
}

function startTimer() {
  if (timer) return;
  timer = setInterval(() => {
    nowTick.value = Date.now();
  }, 1000);
}

function stopTimer() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

watch(
  () => Boolean(props.messageItem?.pending),
  (pending) => {
    if (pending) startTimer();
    else stopTimer();
  },
  { immediate: true },
);

onMounted(() => {
  if (props.messageItem?.pending) startTimer();
});

onBeforeUnmount(() => {
  stopTimer();
});
</script>

<template>
  <template v-if="hasThinking">
      <el-collapse
        v-model="messageItem.thinkingOpenNames"
        class="thinking-collapse noobot-flat-card"
      >
      <el-collapse-item name="thinking-panel">
        <template #title>
          <div class="thinking-title-row">
            <span class="thinking-title-text noobot-flat-chip">{{ translate("message.thinkingExpand") }}</span>
            <span class="thinking-elapsed noobot-flat-chip">
              {{ translate("message.thinkingElapsed", { duration: getThinkingDurationLabel(messageItem) }) }}
            </span>
          </div>
        </template>
        <el-tabs class="thinking-tabs">
          <el-tab-pane :label="translate('message.executionProcess', { count: getExecutionLogCount(messageItem) })">
            <div class="thinking-body-scroll">
              <div
                v-for="(logItem, logIndex) in getExecutionLogs(messageItem)"
                :key="`realtime-${logIndex}`"
                class="thinking-step thinking-single-line"
              >
                <span class="thinking-event">[{{ logItem.type || logItem.event }}]</span>
                <span class="thinking-line-text">{{ logItem.text }}</span>
              </div>
              <div
                v-if="!getExecutionLogCount(messageItem) && messageItem.pending"
                class="thinking-empty"
              >
                {{ translate("message.waitingRealtimeLog") }}
              </div>
              <div
                v-if="!getExecutionLogCount(messageItem) && !messageItem.pending"
                class="thinking-empty"
              >
                {{ translate("message.noExecutionLogs") }}
              </div>
            </div>
          </el-tab-pane>
          <el-tab-pane :label="translate('message.thinkingDetails', { count: getThinkingDetailCount(messageItem) })">
            <div class="thinking-body-scroll">
              <template v-if="!messageItem.pending">
                <div
                  v-for="(groupedToolLogs, groupedToolLogsIndex) in groupCompletedToolLogs(messageItem)"
                  :key="`tool-group-${groupedToolLogsIndex}`"
                  class="thinking-group"
                >
                  <div class="thinking-group-title">
                    {{ groupedToolLogs.label }}
                  </div>
                  <div
                    v-for="(toolLogItem, toolLogIndex) in groupedToolLogs.items"
                    :key="`tool-log-${groupedToolLogsIndex}-${toolLogIndex}`"
                    class="thinking-step tool-step thinking-detail-step thinking-single-line"
                    :style="{ marginLeft: `${toolLogItem.indent || 0}px` }"
                  >
                    <span class="thinking-tree-prefix">
                      {{ getThinkingTreePrefix(toolLogItem) }}
                    </span>
                    <span class="thinking-event">[{{ toolLogItem.type || toolLogItem.event }}]</span>
                    <span
                      class="thinking-detail-text thinking-line-text is-expandable"
                      :class="{
                        'is-expanded': isThinkingDetailExpanded(
                          messageItem,
                          getThinkingDetailItemKey(
                            groupedToolLogs,
                            toolLogItem,
                            toolLogIndex,
                          ),
                        ),
                      }"
                      :title="toolLogItem.text || ''"
                      @click="
                        toggleThinkingDetailExpanded(
                          messageItem,
                          getThinkingDetailItemKey(
                            groupedToolLogs,
                            toolLogItem,
                            toolLogIndex,
                          ),
                        )
                      "
                    >
                      {{ toolLogItem.text }}
                    </span>
                  </div>
                </div>
                <div v-if="!getThinkingDetailCount(messageItem)" class="thinking-empty">
                  {{ translate("message.noToolCalls") }}
                </div>
              </template>
              <div v-else class="thinking-empty">{{ translate("message.detailsAfterDone") }}</div>
            </div>
          </el-tab-pane>
          <el-tab-pane :label="translate('message.injectedMessages', { count: getInjectedMessageCount() })">
            <div class="thinking-body-scroll">
              <div
                v-for="(injectedMessage, injectedMessageIndex) in injectedMessages"
                :key="`injected-${injectedMessageIndex}-${String(injectedMessage.ts || '')}`"
                class="thinking-injected-message"
              >
                <div class="thinking-injected-title">
                  {{ formatInjectedMessageTitle(injectedMessage, injectedMessageIndex) }}
                </div>
                <pre class="thinking-injected-content">{{ injectedMessage.content }}</pre>
              </div>
              <div v-if="!getInjectedMessageCount()" class="thinking-empty">
                {{ translate("message.noInjectedMessages") }}
              </div>
            </div>
          </el-tab-pane>
        </el-tabs>
        <div class="thinking-footer">
          <button
            type="button"
            class="thinking-footer-btn noobot-flat-chip"
            @click="collapseThinkingPanel(messageItem)"
          >
            {{ translate("message.collapse") }}
          </button>
        </div>
      </el-collapse-item>
    </el-collapse>
  </template>
</template>

<style scoped>
.thinking-collapse {
  border: none;
  margin-bottom: var(--noobot-space-md);
  background: var(--noobot-thinking-bg);
  border-radius: var(--noobot-radius-xs);
  overflow: hidden;
}

.thinking-collapse :deep(.el-collapse-item__header) {
  height: 36px;
  line-height: 36px;
  background: transparent;
  border-bottom: none;
  padding: 0 var(--noobot-space-md);
  font-size: var(--noobot-msg-caption-font-size);
  color: var(--noobot-thinking-header);
}

.thinking-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: var(--noobot-space-sm);
}

.thinking-title-text {
  color: var(--noobot-thinking-header);
  font-weight: 600;
  padding: 0 6px;
  min-height: 20px;
  line-height: 1.2;
  border-radius: 999px !important;
}

.thinking-elapsed {
  font-size: 11px;
  color: var(--noobot-thinking-muted);
  gap: 4px;
  padding: 0 6px;
  min-height: 20px;
  line-height: 1.2;
  border-radius: 999px !important;
}

.thinking-collapse :deep(.el-collapse-item__wrap) {
  background: transparent;
  border-bottom: none;
}

.thinking-collapse :deep(.el-collapse-item__content) {
  padding: 0 var(--noobot-space-md) var(--noobot-space-md);
}

.thinking-body-scroll {
  overflow: visible;
  padding-right: 4px;
}

.thinking-step {
  font-size: var(--noobot-msg-caption-font-size);
  color: var(--noobot-thinking-text);
  margin-bottom: 6px;
  padding-left: var(--noobot-space-sm);
  border-left: 2px solid var(--noobot-thinking-line-border);
}

.thinking-group {
  margin-bottom: 10px;
}

.thinking-group-title {
  font-size: var(--noobot-msg-meta-font-size);
  color: var(--noobot-thinking-muted);
  margin: 8px 0 6px;
}

.thinking-event {
  color: var(--noobot-thinking-event);
  margin-right: 6px;
}

.thinking-single-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.thinking-single-line .thinking-event {
  flex: 0 0 auto;
  margin-right: 0;
}

.thinking-line-text {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.thinking-detail-step {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.thinking-tree-prefix {
  flex: 0 0 auto;
  color: var(--noobot-thinking-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}

.thinking-detail-step .thinking-event {
  flex: 0 0 auto;
  margin-right: 0;
}

.thinking-detail-text {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.thinking-detail-text.is-expandable {
  cursor: pointer;
}

.thinking-detail-text.is-expanded {
  overflow: visible;
  text-overflow: unset;
  white-space: normal;
  word-break: break-word;
}

.tool-step {
  border-left-color: var(--noobot-thinking-tool-border);
}

.thinking-injected-message {
  border-left: 2px solid var(--noobot-thinking-tool-border);
  padding-left: var(--noobot-space-sm);
  margin-bottom: 10px;
}

.thinking-injected-title {
  font-size: var(--noobot-msg-meta-font-size);
  color: var(--noobot-thinking-muted);
  margin-bottom: 4px;
}

.thinking-injected-content {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--noobot-thinking-text);
  font: inherit;
  line-height: 1.5;
}

.thinking-empty {
  font-size: 12px;
  color: var(--noobot-thinking-muted);
  padding: 6px 2px 2px;
}

.thinking-tabs :deep(.el-tabs__header) {
  margin-bottom: 8px;
}

.thinking-tabs :deep(.el-tabs__item) {
  color: var(--noobot-thinking-tab);
  font-size: var(--noobot-msg-meta-font-size);
}

.thinking-tabs :deep(.el-tabs__item.is-active) {
  color: var(--noobot-thinking-tab-active);
}

.thinking-tabs :deep(.el-tabs__active-bar) {
  background: var(--noobot-thinking-tab-bar);
}

.thinking-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}

.thinking-footer-btn {
  appearance: none;
  -webkit-appearance: none;
  border: none;
  cursor: pointer;
  height: 20px;
  padding: 0 6px;
  font-size: 11px;
  line-height: 1.2;
  border-radius: 999px !important;
}

.thinking-footer-btn:hover {
  filter: brightness(1.08);
}
</style>
