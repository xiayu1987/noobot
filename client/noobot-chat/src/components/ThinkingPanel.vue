<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed } from "vue";

const props = defineProps({
  messageItem: { type: Object, default: () => ({}) },
});

const hasThinking = computed(() => hasThinkingLogs(props.messageItem));

function getRealtimeLogs(messageItem = {}) {
  return (messageItem.realtimeLogs || []).slice(-10);
}

function hasThinkingLogs(messageItem = {}) {
  if (!messageItem || messageItem.role !== "assistant") return false;
  if (messageItem.pending) return true;
  const hasRealtimeLogs = Array.isArray(messageItem.realtimeLogs)
    ? messageItem.realtimeLogs.length > 0
    : false;
  if (hasRealtimeLogs) return true;
  return Array.isArray(messageItem.completedToolLogs)
    ? messageItem.completedToolLogs.length > 0
    : false;
}

function formatSessionGroupLabel(
  sessionId = "",
  depth = 0,
  dialogProcessId = "",
) {
  const shortSessionId = String(sessionId || "").slice(0, 8) || "unknown";
  const shortDialogProcessId =
    String(dialogProcessId || "").slice(0, 8) || "unknown";
  const levelText = `层级#${Math.max(1, Number(depth || 1))}`;
  if (Number(depth || 0) <= 1) {
    return `主任务#${shortSessionId} · 轮次#${shortDialogProcessId} · ${levelText}`;
  }
  return `子任务#${shortSessionId} · 轮次#${shortDialogProcessId} · ${levelText}`;
}

function groupCompletedToolLogs(messageItem = {}) {
  const toolLogs = Array.isArray(messageItem?.completedToolLogs)
    ? messageItem.completedToolLogs
    : [];
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
    return;
  }
  messageItem.expandedDetailLogKeys = [...currentKeys, detailItemKey];
}

function getExecutionLogCount(messageItem = {}) {
  return getRealtimeLogs(messageItem).length;
}

function getExecutionLogs(messageItem = {}) {
  return getRealtimeLogs(messageItem);
}

function getThinkingDetailCount(messageItem = {}) {
  const completedToolLogs = Array.isArray(messageItem?.completedToolLogs)
    ? messageItem.completedToolLogs
    : [];
  return completedToolLogs.length;
}
</script>

<template>
  <template v-if="hasThinking">
      <el-collapse v-model="messageItem.thinkingOpenNames" class="thinking-collapse">
      <el-collapse-item name="thinking-panel" title="💡 展开思考过程">
        <el-tabs class="thinking-tabs">
          <el-tab-pane :label="`执行过程 (${getExecutionLogCount(messageItem)})`">
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
                执行中，等待实时日志...
              </div>
              <div
                v-if="!getExecutionLogCount(messageItem) && !messageItem.pending"
                class="thinking-empty"
              >
                无执行过程日志
              </div>
            </div>
          </el-tab-pane>
          <el-tab-pane :label="`思考明细 (${getThinkingDetailCount(messageItem)})`">
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
                <div v-if="!(messageItem.completedToolLogs || []).length" class="thinking-empty">
                  无工具调用记录
                </div>
              </template>
              <div v-else class="thinking-empty">执行完成后可查看思考明细</div>
            </div>
          </el-tab-pane>
        </el-tabs>
        <div class="thinking-footer">
          <el-button text size="small" @click="collapseThinkingPanel(messageItem)">
            收起
          </el-button>
        </div>
      </el-collapse-item>
    </el-collapse>
  </template>
</template>

<style scoped>
.thinking-collapse {
  border: none;
  margin-bottom: 12px;
  background: var(--noobot-thinking-bg);
  border-radius: 8px;
  overflow: hidden;
}

.thinking-collapse :deep(.el-collapse-item__header) {
  height: 36px;
  line-height: 36px;
  background: transparent;
  border-bottom: none;
  padding: 0 12px;
  font-size: 13px;
  color: var(--noobot-thinking-header);
}

.thinking-collapse :deep(.el-collapse-item__wrap) {
  background: transparent;
  border-bottom: none;
}

.thinking-collapse :deep(.el-collapse-item__content) {
  padding: 0 12px 12px;
}

.thinking-body-scroll {
  overflow: visible;
  padding-right: 4px;
}

.thinking-step {
  font-size: 13px;
  color: var(--noobot-thinking-text);
  margin-bottom: 6px;
  padding-left: 10px;
  border-left: 2px solid var(--noobot-thinking-line-border);
}

.thinking-group {
  margin-bottom: 10px;
}

.thinking-group-title {
  font-size: 12px;
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
  font-size: 12px;
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
</style>
