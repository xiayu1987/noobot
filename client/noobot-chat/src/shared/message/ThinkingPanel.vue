<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useLocale } from "../i18n/useLocale";
import { isHarnessInjectedMessage } from "../../composables/infra/messageModel";
import {
  getMessageDialogProcessId,
  getMessageRole,
  getMessageSessionId,
  getMessageTurnScopeId,
  isAssistantWithoutTurnScope,
} from "../../composables/infra/messageIdentity";
import { sanitizeExecutionLogForDisplay } from "../../composables/chat/chatEngine/utils";
import { resolveSessionRunMessageRuntimeView } from "../../composables/chat/sessionRunStateMachine";
import { resolveThinkingTiming } from "../../composables/chat/thinkingTimingRegistry";
import {
  getMessageTimestamp,
  getThinkingFinishedAt,
  getThinkingStartedAt,
  formatDurationMs,
  nowMs,
  resolveThinkingDurationMs,
  resolveTimeMs,
} from "../../composables/infra/timeFields";
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
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";

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
const nowTick = ref(nowMs());
const detailExpansionTick = ref(0);
let timer = null;
const EXECUTION_LOG_DISPLAY_LIMIT = QUANTITY_THRESHOLDS.client.executionLogDisplayLimit;

function getRealtimeLogs(messageItem = {}) {
  return getAllRealtimeLogs(messageItem)
    .filter((logItem) => !isPluginCapabilityResponseLog(logItem))
    .filter((logItem) => !isGuidanceAnalysisResponseLog(logItem))
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
    getMessageRole(messageItem) === "assistant" &&
    messageItem?.pending === true &&
    messageItem?.hasFirstStreamEvent !== true
  );
}

function getExecutionLogs(messageItem = {}) {
  const realtimeLogs = getRealtimeLogs(messageItem);
  if (realtimeLogs.length > 0) return realtimeLogs;
  return getCompletedToolLogsForMessage(messageItem).slice(-EXECUTION_LOG_DISPLAY_LIMIT);
}

function getAllCompletedLogs(messageItem = {}) {
  if (isAssistantWithoutTurnScope(messageItem)) return [];
  const completedToolLogs = Array.isArray(messageItem?.processCompletedToolLogs)
    ? messageItem.processCompletedToolLogs
    : Array.isArray(messageItem?.completedToolLogs)
    ? messageItem.completedToolLogs
    : [];
  const fallbackToolLogs = buildFallbackCompletedToolLogs(messageItem);
  if (completedToolLogs.length <= 0) return fallbackToolLogs;
  if (fallbackToolLogs.length <= 0) return completedToolLogs;
  return mergeCompletedAndFallbackToolLogs(completedToolLogs, fallbackToolLogs);
}

function normalizeLogString(value = "") {
  return String(value || "").trim().toLowerCase();
}

function isPluginAnalysisResponseLog(logItem = {}) {
  const eventName = normalizeLogString(logItem?.event || logItem?.type);
  const purpose = normalizeLogString(logItem?.purpose || logItem?.data?.purpose);
  const pluginFlow = normalizeLogString(
    logItem?.pluginFlow
      || logItem?.data?.pluginFlow
      || logItem?.harnessFlow
      || logItem?.data?.harnessFlow,
  );
  const chain = normalizeLogString(logItem?.chain || logItem?.data?.chain || logItem?.executionScope || logItem?.data?.executionScope);
  return (
    isGuidanceAnalysisEventName(eventName) &&
    purpose === "guidance" &&
    pluginFlow === "analysis" &&
    chain === "auxiliary"
  );
}

function isGuidanceAnalysisEventName(eventName = "") {
  return eventName === "guidance_analysis_response" || eventName === "guidance_analysis";
}

function isGuidanceAnalysisResponseLog(logItem = {}) {
  const eventName = normalizeLogString(logItem?.event || logItem?.type || logItem?.rawEvent);
  return isGuidanceAnalysisEventName(eventName);
}

function isPluginCapabilityResponseLog(logItem = {}) {
  const eventName = normalizeLogString(logItem?.event || logItem?.type);
  return eventName === "plugin_capability_response" || eventName === "harness_capability_response";
}

function getPluginAnalysisLogOutput(logItem = {}) {
  const output = String(logItem?.output ?? logItem?.data?.output ?? "").trim();
  if (output) return output;
  const text = String(logItem?.text || "").trim();
  return text.replace(/^(?:Plugin|Harness)\s+模型返回\s*\/\s*[^\n]+\n?/i, "").trim();
}

function getLatestPluginAnalysisLog(messageItem = {}) {
  const logs = [
    ...getAllRealtimeLogs(messageItem),
    ...getAllCompletedLogs(messageItem),
  ].filter(isPluginAnalysisResponseLog);
  for (let index = logs.length - 1; index >= 0; index -= 1) {
    const output = getPluginAnalysisLogOutput(logs[index]);
    if (output) return { ...logs[index], output };
  }
  return null;
}

function getExecutionLogCount(messageItem = {}) {
  const explicitTotal = toValidExecutionLogTotal(
    messageItem.processExecutionLogTotal
      ?? messageItem.executionLogTotal
      ?? messageItem.execution_log_total,
  );
  if (explicitTotal !== null) {
    const hiddenAnalysisLogCount = [
      ...getAllRealtimeLogs(messageItem),
      ...getAllCompletedLogs(messageItem),
    ].filter((logItem) => isPluginCapabilityResponseLog(logItem) || isGuidanceAnalysisResponseLog(logItem)).length;
    return Math.max(0, explicitTotal - hiddenAnalysisLogCount);
  }

  const realtimeLogs = getAllRealtimeLogs(messageItem).filter(
    (logItem) => !isPluginCapabilityResponseLog(logItem) && !isGuidanceAnalysisResponseLog(logItem),
  );
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
  if (!messageItem || getMessageRole(messageItem) !== "assistant") return false;
  if (resolveSessionRunMessageRuntimeView(messageItem).running) return true;
  if (hasSummaryThinkingDetails(messageItem)) return true;
  if (getLatestPluginAnalysisLog(messageItem)) return true;
  const hasRealtimeLogs = Array.isArray(messageItem.processRealtimeLogs) || Array.isArray(messageItem.realtimeLogs)
    ? getRealtimeLogs(messageItem).length > 0
    : false;
  if (hasRealtimeLogs) return true;
  return getCompletedToolLogsForMessage(messageItem).length > 0;
}

function isMessageRuntimeRunning(messageItem = {}) {
  return resolveSessionRunMessageRuntimeView(messageItem).running;
}


function isSameFrontendTurnScope(target = {}, candidate = {}) {
  const targetTurnScopeId = getMessageTurnScopeId(target);
  const candidateTurnScopeId = getMessageTurnScopeId(candidate);
  if (targetTurnScopeId && candidateTurnScopeId) {
    const targetSessionId = getMessageSessionId(target);
    const candidateSessionId = getMessageSessionId(candidate);
    return (
      targetTurnScopeId === candidateTurnScopeId &&
      (!targetSessionId || !candidateSessionId || targetSessionId === candidateSessionId)
    );
  }
  return false;
}

function getInjectedMessagesForMessage(messageItem = {}) {
  if (!messageItem || getMessageRole(messageItem) !== "assistant") return [];
  if (isFreshPendingAssistant(messageItem)) return [];
  const dialogProcessId = getMessageDialogProcessId(messageItem);
  const candidateMessages = Array.isArray(props.allMessages) ? props.allMessages : [];
  return candidateMessages.filter((item = {}) => {
    if (!isHarnessInjectedMessage(item)) return false;
    if (isSameFrontendTurnScope(messageItem, item)) return true;
    if (!getMessageTurnScopeId(messageItem) && dialogProcessId) {
      return getMessageDialogProcessId(item) === dialogProcessId;
    }
    return !getMessageTurnScopeId(messageItem) && !dialogProcessId;
  });
}

function getScopedMessagesForMessage(messageItem = {}) {
  if (isFreshPendingAssistant(messageItem)) return [];
  const dialogProcessId = getMessageDialogProcessId(messageItem);
  const targetTurnScopeId = getMessageTurnScopeId(messageItem);
  const candidateMessages = Array.isArray(props.allMessages) ? props.allMessages : [];
  return candidateMessages.filter((item = {}) => {
    if (targetTurnScopeId) return isSameFrontendTurnScope(messageItem, item);
    if (dialogProcessId && getMessageDialogProcessId(item) !== dialogProcessId) {
      return false;
    }
    return true;
  });
}

function isToolRelatedMessage(messageItem = {}) {
  const role = getMessageRole(messageItem).toLowerCase();
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
    const dialogProcessId = getMessageDialogProcessId(item) || getMessageDialogProcessId(messageItem);
    const timestamp = item?.ts || messageItem?.ts || "";
    const itemType = String(item?.type || "").trim().toLowerCase();
    const itemRole = getMessageRole(item).toLowerCase();
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
          id: toolCall?.id,
          tool_call_id: toolCall?.id,
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
        tool_call_id: item?.tool_call_id || item?.toolCallId,
        text: buildToolResultText(item),
        ts: timestamp,
      });
    }
  }
  return fallbackToolLogs;
}

function getToolLogIdentity(logItem = {}) {
  const eventName = String(logItem?.event || logItem?.type || "").trim().toLowerCase();
  const callId = String(
    logItem?.tool_call_id
      || logItem?.toolCallId
      || logItem?.id
      || logItem?.callId
      || logItem?.data?.tool_call_id
      || logItem?.data?.toolCallId
      || "",
  ).trim();
  if (callId) return `${eventName}|id:${callId}`;
  return `${eventName}|${String(logItem?.text || "").trim()}|${String(logItem?.ts || "").trim()}`;
}

function mergeCompletedAndFallbackToolLogs(completedToolLogs = [], fallbackToolLogs = []) {
  const mergedLogs = [];
  const seenKeys = new Set();
  const appendLog = (logItem = {}) => {
    const key = getToolLogIdentity(logItem);
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    mergedLogs.push(logItem);
  };
  fallbackToolLogs.forEach(appendLog);
  completedToolLogs.forEach(appendLog);
  return mergedLogs;
}

function getCompletedToolLogsForMessage(messageItem = {}) {
  return getAllCompletedLogs(messageItem)
    .filter((logItem) => !isPluginCapabilityResponseLog(logItem))
    .map((logItem) => sanitizeExecutionLogForDisplay(logItem))
    .filter(Boolean);
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
  turnScopeId = "",
) {
  const shortSessionId = String(sessionId || "").slice(0, 8) || translate("message.unknownShort");
  const shortTurnScopeId =
    String(turnScopeId || "").replace(/^client-turn:/, "").slice(0, 8) || translate("message.unknownShort");
  const levelText = translate("message.depthLabel", { depth: Math.max(1, Number(depth || 1)) });
  if (Number(depth || 0) <= 1) {
    return translate("message.mainTaskGroup", {
      sessionId: shortSessionId,
      turnScopeId: shortTurnScopeId,
      level: levelText,
    });
  }
  return translate("message.subTaskGroup", {
    sessionId: shortSessionId,
    turnScopeId: shortTurnScopeId,
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
    const turnScopeId = String(logItem?.turnScopeId || logItem?.dialogProcessId || "");
    const groupKey = `${sessionId}|${depth}|${turnScopeId}`;
    let group = groupedMap.get(groupKey);
    if (!group) {
      group = {
        key: groupKey,
        sessionId,
        depth,
        label: formatSessionGroupLabel(sessionId, depth, turnScopeId),
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
  const completedToolLogCount = getCompletedToolLogsForMessage(messageItem).length;
  if (completedToolLogCount > 0) return completedToolLogCount;
  const summaryThinkingDetailCount = getSummaryThinkingDetailCount(messageItem);
  if (summaryThinkingDetailCount > 0) return summaryThinkingDetailCount;
  const toolCalls = Array.isArray(messageItem?.toolCalls)
    ? messageItem.toolCalls
    : Array.isArray(messageItem?.tool_calls)
    ? messageItem.tool_calls
    : [];
  if (toolCalls.length > 0) return toolCalls.length;
  const realtimeLogs = Array.isArray(messageItem?.processRealtimeLogs)
    ? messageItem.processRealtimeLogs
    : Array.isArray(messageItem?.realtimeLogs)
    ? messageItem.realtimeLogs
    : [];
  return realtimeLogs.filter((logItem = {}) => {
    const event = String(logItem?.event || logItem?.type || "").toLowerCase();
    return event.includes("tool") || event.includes("function");
  }).length;
}

function getThinkingDetailLabel(messageItem = {}) {
  return translate("message.thinkingDetails", { count: getThinkingDetailCount(messageItem) });
}

function getThinkingTreePrefix(toolLogItem = {}) {
  const depth = Math.max(1, Number(toolLogItem?.depth || 1));
  if (depth <= 1) return "•";
  return `${"│  ".repeat(Math.max(0, depth - 2))}└─`;
}

function parseAnyTimeMs(...values) {
  return resolveTimeMs(...values);
}


function getThinkingDurationMs(messageItem = {}) {
  const hasMessageTurnScopeId = Boolean(getMessageTurnScopeId(messageItem));
  const runtimeView = resolveSessionRunMessageRuntimeView(messageItem);
  const channelState = runtimeView.channelState || {};
  const msgTs = parseAnyTimeMs(getMessageTimestamp(messageItem));
  const canUseAssociatedTurnTiming = !isAssistantWithoutTurnScope(messageItem);
  const channelStartedAt = canUseAssociatedTurnTiming
    ? parseAnyTimeMs(
        channelState?.createdAt,
        channelState?.createdAtMs,
      )
    : 0;
  const channelUpdatedAt = canUseAssociatedTurnTiming
    ? parseAnyTimeMs(
        channelState?.updatedAt,
        channelState?.updatedAtMs,
        channelState?.timestamp,
      )
    : 0;
  const sessionId = getMessageSessionId(messageItem) || String(channelState?.sessionId || "").trim();
  const turnScopeId = hasMessageTurnScopeId ? getMessageTurnScopeId(messageItem) : "";
  const dialogProcessId = getMessageDialogProcessId(messageItem) || String(channelState?.dialogProcessId || "").trim();
  const timingScope = turnScopeId ? { sessionId, turnScopeId } : null;
  const startedAt = parseAnyTimeMs(getThinkingStartedAt(messageItem));
  const finishedAt = parseAnyTimeMs(getThinkingFinishedAt(messageItem));
  const persistedTiming = timingScope ? resolveThinkingTiming(timingScope) || {} : {};
  const persistedStartedAt = parseAnyTimeMs(persistedTiming?.startedAtMs, persistedTiming?.startedAt);
  const persistedFinishedAt = parseAnyTimeMs(persistedTiming?.finishedAtMs, persistedTiming?.finishedAt);
  const realtimeLogs = getAllRealtimeLogs(messageItem);
  const completedToolLogs = getCompletedToolLogsForMessage(messageItem);
  const logTimes = [...realtimeLogs, ...completedToolLogs]
    .map((logItem) =>
      parseAnyTimeMs(getMessageTimestamp(logItem)),
    )
    .filter((timeValue) => timeValue > 0);
  const fallbackStartedAt = parseAnyTimeMs(
    ...(logTimes.length ? [Math.min(...logTimes)] : []),
    msgTs,
  );
  const fallbackFinishedAt = parseAnyTimeMs(
    ...(logTimes.length ? [Math.max(...logTimes)] : []),
    msgTs,
  );
  return resolveThinkingDurationMs({
    messageStartedAt: startedAt,
    messageFinishedAt: finishedAt,
    channelStartedAt,
    channelFinishedAt: channelUpdatedAt,
    cachedStartedAt: persistedStartedAt,
    cachedFinishedAt: persistedFinishedAt,
    fallbackStartedAt,
    fallbackFinishedAt,
    now: nowTick.value,
    pending: runtimeView.running,
  });
}

function isThinkingRuntimeRunning(messageItem = {}) {
  return resolveSessionRunMessageRuntimeView(messageItem).running;
}

function getThinkingDurationLabel(messageItem = {}) {
  return formatDurationMs(getThinkingDurationMs(messageItem));
}

function startTimer() {
  if (timer) return;
  timer = setInterval(() => {
    nowTick.value = nowMs();
  }, 1000);
}

function stopTimer() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}


watch(
  () => isThinkingRuntimeRunning(props.messageItem),
  (running) => {
    if (running) startTimer();
    else stopTimer();
  },
  { immediate: true },
);

watch(
  () => isThinkingRuntimeRunning(props.messageItem),
  (running) => {
    if (running) startTimer();
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
        class="thinking-realtime-shell"
        :class="{ 'is-running': isThinkingRuntimeRunning(messageItem) }"
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
        <BaseTabPanelBody class="thinking-realtime-body">
          <div v-if="getLatestPluginAnalysisLog(messageItem)" class="thinking-analysis-block">
            <BaseMetaLabel class="thinking-analysis-title" text="分析流程" />
            <BaseNoteBlock
              :content="getLatestPluginAnalysisLog(messageItem).output"
            />
          </div>
          <div class="thinking-realtime-log-stream">
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
                v-if="!getExecutionLogCount(messageItem) && isMessageRuntimeRunning(messageItem)"
                :text="translate('message.waitingRealtimeLog')"
              />
              <BaseEmptyHint
                v-if="!getExecutionLogCount(messageItem) && !isMessageRuntimeRunning(messageItem)"
                :text="translate('message.noExecutionLogs')"
              />
          </div>
              <div class="thinking-execution-actions">
                <BasePillButton
                  class="thinking-detail-action-button noobot-primary-pill-action"
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
          <template v-if="!isMessageRuntimeRunning(messageItem)">
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
  border-radius: var(--noobot-radius-pill);
}

.thinking-analysis-block {
  flex: 0 0 auto;
  margin-top: 0;
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--noobot-divider);
}

.thinking-analysis-title {
  margin-bottom: 8px;
}

.thinking-analysis-block :deep(.base-note-block__content) {
  font-size: var(--noobot-msg-caption-font-size);
  max-height: none;
  overflow: visible;
  white-space: pre-wrap;
}

.thinking-realtime-shell :deep(.el-collapse-item__content) {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.thinking-realtime-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: auto;
  max-height: none;
  overflow: visible;
}

.thinking-realtime-log-stream {
  flex: 0 1 auto;
  min-height: 0;
  overflow: visible;
  overflow-x: hidden;
  padding-right: 0;
  -webkit-overflow-scrolling: touch;
}

.thinking-execution-actions {
  flex: 0 0 auto;
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--noobot-divider);
}

.thinking-detail-action-button {
  min-height: 34px;
  padding: 0 14px;
}

@media (max-width: 720px) {
  .thinking-realtime-body {
    max-height: none;
  }

  .thinking-realtime-log-stream {
    min-height: 0;
  }

  .thinking-analysis-block :deep(.base-note-block__content) {
    max-height: none;
  }

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
