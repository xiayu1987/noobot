<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useLocale } from "../i18n/useLocale";
import { isHarnessInjectedMessage } from "../../composables/infra/messageModel";
import { sanitizeExecutionLogForDisplay } from "../../composables/chat/chatEngine/utils";
import {
  BaseEmptyHint,
  BaseMetaLabel,
  BaseNoteBlock,
  BasePillButton,
  BaseSectionHeader,
  BaseTabPanelBody,
  BaseThinkingLogLine,
  BaseThinkingPanelShell,
} from "../ui";

const props = defineProps({
  messageItem: { type: Object, default: () => ({}) },
  allMessages: { type: Array, default: () => [] },
  variant: { type: String, default: "panel" },
});

const emit = defineEmits(["open-thinking-details"]);

const injectedMessages = computed(() => getInjectedMessagesForMessage(props.messageItem));
const hasThinking = computed(
  () => hasThinkingLogs(props.messageItem) || injectedMessages.value.length > 0,
);
const { translate } = useLocale();
const nowTick = ref(Date.now());
const detailExpansionTick = ref(0);
let timer = null;
const EXECUTION_LOG_DISPLAY_LIMIT = 10;

function getRealtimeLogs(messageItem = {}) {
  return getAllRealtimeLogs(messageItem)
    .map((logItem) => sanitizeExecutionLogForDisplay(logItem))
    .filter(Boolean)
    .slice(-EXECUTION_LOG_DISPLAY_LIMIT);
}

function getAllRealtimeLogs(messageItem = {}) {
  if (Array.isArray(messageItem?.processRealtimeLogs)) return messageItem.processRealtimeLogs;
  return Array.isArray(messageItem?.realtimeLogs) ? messageItem.realtimeLogs : [];
}

function isFreshPendingAssistant(messageItem = {}) {
  return (
    String(messageItem?.role || "").trim() === "assistant" &&
    messageItem?.pending === true &&
    messageItem?.hasFirstStreamEvent !== true
  );
}

function getExecutionLogs(messageItem = {}) {
  const realtimeLogs = getRealtimeLogs(messageItem);
  if (realtimeLogs.length > 0) return realtimeLogs;
  return getCompletedToolLogsForMessage(messageItem).slice(-EXECUTION_LOG_DISPLAY_LIMIT);
}

function getExecutionLogCount(messageItem = {}) {
  const explicitTotal = toValidExecutionLogTotal(
    messageItem.processExecutionLogTotal
      ?? messageItem.executionLogTotal
      ?? messageItem.execution_log_total,
  );
  if (explicitTotal !== null) return explicitTotal;

  const realtimeLogs = getAllRealtimeLogs(messageItem);
  if (realtimeLogs.length > 0) return realtimeLogs.length;

  const completedToolLogs = getCompletedToolLogsForMessage(messageItem);
  if (completedToolLogs.length > 0) return completedToolLogs.length;

  const summaryThinkingDetailCount = getSummaryThinkingDetailCount(messageItem);
  if (summaryThinkingDetailCount > 0) return summaryThinkingDetailCount;

  return getExecutionLogs(messageItem).length;
}

function toValidExecutionLogTotal(value) {
  const total = Number(value);
  return Number.isFinite(total) && total >= 0 ? total : null;
}

function getSummaryThinkingDetailCount(messageItem = {}) {
  const count = Number(messageItem?.thinkingDetailCount ?? messageItem?.thinking_detail_count);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function hasSummaryThinkingDetails(messageItem = {}) {
  return messageItem?.hasThinkingDetails === true || getSummaryThinkingDetailCount(messageItem) > 0;
}

function hasThinkingLogs(messageItem = {}) {
  if (!messageItem || messageItem.role !== "assistant") return false;
  if (messageItem.pending) return true;
  if (hasSummaryThinkingDetails(messageItem)) return true;
  const hasRealtimeLogs = Array.isArray(messageItem.processRealtimeLogs) || Array.isArray(messageItem.realtimeLogs)
    ? getRealtimeLogs(messageItem).length > 0
    : false;
  if (hasRealtimeLogs) return true;
  return getCompletedToolLogsForMessage(messageItem).length > 0;
}


function getInjectedMessagesForMessage(messageItem = {}) {
  if (!messageItem || messageItem.role !== "assistant") return [];
  if (isFreshPendingAssistant(messageItem)) return [];
  const dialogProcessId = String(messageItem?.dialogProcessId || "").trim();
  const candidateMessages = Array.isArray(props.allMessages) ? props.allMessages : [];
  return candidateMessages.filter((item = {}) => {
    if (!isHarnessInjectedMessage(item)) return false;
    if (!dialogProcessId) return true;
    return String(item?.dialogProcessId || "").trim() === dialogProcessId;
  });
}

function getScopedMessagesForMessage(messageItem = {}) {
  if (isFreshPendingAssistant(messageItem)) return [];
  const dialogProcessId = String(messageItem?.dialogProcessId || "").trim();
  const hasExplicitThinkingDetailPayload =
    (Array.isArray(messageItem?.processCompletedToolLogs) && messageItem.processCompletedToolLogs.length > 0)
    || (Array.isArray(messageItem?.completedToolLogs) && messageItem.completedToolLogs.length > 0);
  const candidateMessages = Array.isArray(props.allMessages) ? props.allMessages : [];
  return candidateMessages.filter((item = {}) => {
    if (dialogProcessId && String(item?.dialogProcessId || "").trim() !== dialogProcessId) {
      return false;
    }
    return true;
  });
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
  if (!contentText) return translate("message.toolResultFallback");
  try {
    const parsed = JSON.parse(contentText);
    const toolName = String(parsed?.toolName || parsed?.name || "").trim();
    const status = String(parsed?.status || "").trim();
    const okText = typeof parsed?.ok === "boolean" ? `ok=${parsed.ok}` : "";
    return [toolName || translate("message.toolResultFallback"), status, okText].filter(Boolean).join(" ");
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
  const completedToolLogs = Array.isArray(messageItem?.processCompletedToolLogs)
    ? messageItem.processCompletedToolLogs
    : Array.isArray(messageItem?.completedToolLogs)
    ? messageItem.completedToolLogs
    : [];
  const sourceToolLogs = completedToolLogs.length > 0
    ? completedToolLogs
    : buildFallbackCompletedToolLogs(messageItem);
  return sourceToolLogs.map((logItem) => sanitizeExecutionLogForDisplay(logItem)).filter(Boolean);
}

function getInjectedMessageCount() {
  return injectedMessages.value.length;
}

function formatInjectedMessageTitle(messageItem = {}, messageIndex = 0) {
  const timeText = String(messageItem?.ts || "").trim();
  const sourceText = String(messageItem?.injectedBy || translate("message.injectedSourceHarness")).trim();
  return `${messageIndex + 1}. ${sourceText}${timeText ? ` · ${timeText}` : ""}`;
}

function formatSessionGroupLabel(
  sessionId = "",
  depth = 0,
  dialogProcessId = "",
) {
  const shortSessionId = String(sessionId || "").slice(0, 8) || translate("message.unknownShort");
  const shortDialogProcessId =
    String(dialogProcessId || "").slice(0, 8) || translate("message.unknownShort");
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

function openThinkingDetailDrawer() {
  emit("open-thinking-details", { messageItem: props.messageItem, allMessages: props.allMessages });
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


function getThinkingDetailCount(messageItem = {}) {
  const explicitExecutionLogTotal = toValidExecutionLogTotal(
    messageItem.processExecutionLogTotal
      ?? messageItem.executionLogTotal
      ?? messageItem.execution_log_total,
  );
  if (explicitExecutionLogTotal !== null && explicitExecutionLogTotal > 0) {
    return explicitExecutionLogTotal;
  }
  const completedToolLogCount = getCompletedToolLogsForMessage(messageItem).length;
  if (completedToolLogCount > 0) return completedToolLogCount;
  return getSummaryThinkingDetailCount(messageItem);
}

function getThinkingDetailLabel(messageItem = {}) {
  return translate("message.thinkingDetails", { count: getThinkingDetailCount(messageItem) });
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
  const scopedMessages = getScopedMessagesForMessage(messageItem);
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

watch(
  () => props.messageItem?.pending,
  (pending) => {
    if (pending) startTimer();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  stopTimer();
});
</script>

<template>
  <template v-if="variant !== 'details' && hasThinking">
      <BaseThinkingPanelShell
        v-model="messageItem.thinkingOpenNames"
        item-name="thinking-panel"
      >
        <template #title>
          <BaseSectionHeader :title="translate('message.thinkingExpand')" class="thinking-title-row">
            <template #extra>
              <span class="thinking-elapsed noobot-flat-chip">
                {{ translate("message.thinkingElapsed", { duration: getThinkingDurationLabel(messageItem) }) }}
              </span>
            </template>
          </BaseSectionHeader>
        </template>
        <BaseTabPanelBody>
              <div
                v-for="(logItem, logIndex) in getExecutionLogs(messageItem)"
                :key="`realtime-${logIndex}`"
              >
                <BaseThinkingLogLine
                  :event-text="logItem.type || logItem.event"
                  :content-text="logItem.text"
                />
              </div>
              <BaseEmptyHint
                v-if="!getExecutionLogCount(messageItem) && messageItem.pending"
                :text="translate('message.waitingRealtimeLog')"
              />
              <BaseEmptyHint
                v-if="!getExecutionLogCount(messageItem) && !messageItem.pending"
                :text="translate('message.noExecutionLogs')"
              />
              <div class="thinking-execution-actions">
                <BasePillButton
                  class="thinking-detail-action-button"
                  :label="getThinkingDetailLabel(messageItem)"
                  @click="openThinkingDetailDrawer"
                />
              </div>
        </BaseTabPanelBody>
        <template #footer>
          <BasePillButton
            :label="translate('message.collapse')"
            @click="collapseThinkingPanel(messageItem)"
          />
        </template>
      </BaseThinkingPanelShell>
  </template>
  <BaseTabPanelBody v-else-if="hasThinking" class="thinking-details-panel">
          <template v-if="!messageItem.pending">
            <el-tabs class="thinking-details-tabs">
              <el-tab-pane :label="getThinkingDetailLabel(messageItem)">
                <BaseTabPanelBody class="thinking-details-scroll-body thinking-details-log-body">
                  <div
                    v-for="(groupedToolLogs, groupedToolLogsIndex) in groupCompletedToolLogs(messageItem)"
                    :key="`tool-group-${groupedToolLogsIndex}`"
                    class="thinking-group"
                  >
                    <BaseMetaLabel class="thinking-group-title" :text="groupedToolLogs.label" />
                    <div
                      v-for="(toolLogItem, toolLogIndex) in groupedToolLogs.items"
                      :key="`tool-log-${groupedToolLogsIndex}-${toolLogIndex}`"
                    >
                      <BaseThinkingLogLine
                        :indent="Number(toolLogItem.indent || 0)"
                        :prefix-text="getThinkingTreePrefix(toolLogItem)"
                        :event-text="toolLogItem.type || toolLogItem.event"
                        :content-text="toolLogItem.text"
                        :tool="true"
                        :expandable="true"
                        :expanded="
                          isThinkingDetailExpanded(
                            messageItem,
                            getThinkingDetailItemKey(groupedToolLogs, toolLogItem, toolLogIndex),
                          )
                        "
                        :title-text="toolLogItem.text || ''"
                        @toggle="
                          toggleThinkingDetailExpanded(
                            messageItem,
                            getThinkingDetailItemKey(groupedToolLogs, toolLogItem, toolLogIndex),
                          )
                        "
                      />
                    </div>
                  </div>
                  <BaseEmptyHint
                    v-if="!getThinkingDetailCount(messageItem)"
                    :text="translate('message.noToolCalls')"
                  />
                </BaseTabPanelBody>
              </el-tab-pane>
              <el-tab-pane :label="translate('message.injectedMessages', { count: getInjectedMessageCount() })">
                <BaseTabPanelBody class="thinking-details-scroll-body thinking-details-injected-body">
                  <BaseNoteBlock
                    v-for="(injectedMessage, injectedMessageIndex) in injectedMessages"
                    :key="`detail-injected-${injectedMessageIndex}-${String(injectedMessage.ts || '')}`"
                    :title="formatInjectedMessageTitle(injectedMessage, injectedMessageIndex)"
                    :content="String(injectedMessage.content || '')"
                  />
                  <BaseEmptyHint
                    v-if="!getInjectedMessageCount()"
                    :text="translate('message.noInjectedMessages')"
                  />
                </BaseTabPanelBody>
              </el-tab-pane>
            </el-tabs>
          </template>
          <BaseEmptyHint v-else :text="translate('message.detailsAfterDone')" />
  </BaseTabPanelBody>
  <template v-else></template>
</template>

<style scoped>

.thinking-title-row {
  width: 100%;
}

.thinking-title-row :deep(.base-section-header__title) {
  color: var(--noobot-thinking-header);
  font-weight: 600;
}

.thinking-detail-title-row {
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--noobot-divider);
}

.thinking-detail-title-row :deep(.base-section-header__title) {
  color: var(--noobot-thinking-header);
  font-weight: 600;
}

.thinking-elapsed {
  font-size: 11px;
  color: var(--noobot-thinking-muted);
  gap: 4px;
  padding: 0 6px;
  min-height: 20px;
  line-height: 1.2;
  border-radius: 999px;
}

.thinking-execution-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--noobot-divider);
}

.thinking-detail-action-button {
  min-height: 34px;
  padding: 0 14px;
  border: 1px solid color-mix(in srgb, var(--noobot-primary, #409eff) 42%, transparent);
  background: linear-gradient(135deg, color-mix(in srgb, var(--noobot-primary, #409eff) 14%, transparent), color-mix(in srgb, var(--noobot-primary, #409eff) 6%, transparent));
  color: var(--noobot-primary, #409eff);
  font-weight: 600;
  filter: none;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--noobot-primary, #409eff) 6%, transparent);
  transition: border-color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
}

.thinking-detail-action-button:hover {
  filter: none;
  border-color: color-mix(in srgb, var(--noobot-primary, #409eff) 62%, transparent);
  background: linear-gradient(135deg, color-mix(in srgb, var(--noobot-primary, #409eff) 20%, transparent), color-mix(in srgb, var(--noobot-primary, #409eff) 10%, transparent));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--noobot-primary, #409eff) 12%, transparent);
}

.thinking-detail-action-button:active {
  filter: none;
  background: linear-gradient(135deg, color-mix(in srgb, var(--noobot-primary, #409eff) 16%, transparent), color-mix(in srgb, var(--noobot-primary, #409eff) 8%, transparent));
}

@media (max-width: 720px) {
  .thinking-execution-actions {
    justify-content: stretch;
  }

  .thinking-detail-action-button {
    width: 100%;
    min-height: 42px;
    justify-content: center;
  }
}

.thinking-group {
  margin-bottom: 10px;
}

.thinking-group-title {
  margin: 8px 0 6px;
}

.thinking-details-panel {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 12px;
  box-sizing: border-box;
  overflow: hidden;
}

.thinking-details-tabs {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.thinking-details-tabs :deep(.el-tabs__header) {
  flex: 0 0 auto;
  margin-bottom: 8px;
  background: var(--noobot-panel-bg);
  z-index: 1;
}

.thinking-details-tabs :deep(.el-tabs__content) {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.thinking-details-tabs :deep(.el-tab-pane) {
  height: 100%;
  min-height: 0;
}

.thinking-details-scroll-body {
  height: 100%;
  min-height: 0;
  overflow: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
}

.thinking-details-injected-body :deep(.base-note-block__content) {
  font-size: var(--noobot-msg-caption-font-size);
}

</style>
