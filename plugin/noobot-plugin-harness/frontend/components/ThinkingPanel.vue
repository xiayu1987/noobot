<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useLocale } from "../../../../client/noobot-chat/src/shared/i18n/useLocale";
import { isHarnessInjectedMessage } from "../../../../client/noobot-chat/src/composables/infra/messageModel";
import {
  BaseEmptyHint,
  BaseMetaLabel,
  BaseNoteBlock,
  BasePillButton,
  BaseSectionHeader,
  BaseTabPanelBody,
  BaseThinkingLogLine,
  BaseThinkingPanelShell,
} from "../../../../client/noobot-chat/src/shared/ui";

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
        <el-tabs>
          <el-tab-pane :label="translate('message.executionProcess', { count: getExecutionLogCount(messageItem) })">
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
            </BaseTabPanelBody>
          </el-tab-pane>
          <el-tab-pane :label="translate('message.thinkingDetails', { count: getThinkingDetailCount(messageItem) })">
            <BaseTabPanelBody>
              <template v-if="!messageItem.pending">
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
                          getThinkingDetailItemKey(
                            groupedToolLogs,
                            toolLogItem,
                            toolLogIndex,
                          ),
                        )
                      "
                      :title-text="toolLogItem.text || ''"
                      @toggle="
                        toggleThinkingDetailExpanded(
                          messageItem,
                          getThinkingDetailItemKey(
                            groupedToolLogs,
                            toolLogItem,
                            toolLogIndex,
                          ),
                        )
                      "
                    />
                  </div>
                </div>
                <BaseEmptyHint
                  v-if="!getThinkingDetailCount(messageItem)"
                  :text="translate('message.noToolCalls')"
                />
              </template>
              <BaseEmptyHint v-else :text="translate('message.detailsAfterDone')" />
            </BaseTabPanelBody>
          </el-tab-pane>
          <el-tab-pane :label="translate('message.injectedMessages', { count: getInjectedMessageCount() })">
            <BaseTabPanelBody>
              <BaseNoteBlock
                v-for="(injectedMessage, injectedMessageIndex) in injectedMessages"
                :key="`injected-${injectedMessageIndex}-${String(injectedMessage.ts || '')}`"
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
        <template #footer>
          <BasePillButton
            :label="translate('message.collapse')"
            @click="collapseThinkingPanel(messageItem)"
          />
        </template>
      </BaseThinkingPanelShell>
  </template>
</template>

<style scoped>

.thinking-title-row {
  width: 100%;
}

.thinking-title-row :deep(.base-section-header__title) {
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

.thinking-group {
  margin-bottom: 10px;
}

.thinking-group-title {
  margin: 8px 0 6px;
}

</style>
