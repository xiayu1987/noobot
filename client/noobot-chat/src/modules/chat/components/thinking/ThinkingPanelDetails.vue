<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref, watch } from "vue";
import {
  BaseEmptyHint,
  BaseMetaLabel,
  BaseNoteBlock,
  BaseTabPanelBody,
  BaseThinkingLogLine,
} from "../../../../shared/public-api/ui.js";
import { logThinkingReplayDebug } from "../../../debug/loggers/thinkingReplayDebugLogger.js";
import { logStateMachineDebug } from "../../../debug/loggers/stateMachineLogger.js";
const props = defineProps({
  messageItem: { type: Object, required: true },
  translate: { type: Function, required: true },
  isRunning: Boolean,
  groupedToolLogs: { type: Array, default: () => [] },
  thinkingContentItems: { type: Array, default: () => [] },
  detailCount: { type: Number, default: 0 },
  taskCheckReceipts: { type: Array, default: () => [] },
  getTreePrefix: { type: Function, required: true },
  getDetailKey: { type: Function, required: true },
  isExpanded: { type: Function, required: true },
  toggleExpanded: { type: Function, required: true },
});
const rendererProjection = computed(() => (Array.isArray(props.groupedToolLogs)
  ? props.groupedToolLogs
  : []).flatMap((group = {}) => (Array.isArray(group.items) ? group.items : [])));
const rendererProjectionSignature = computed(() => [
  rendererProjection.value.map((item = {}) => [
    item.eventId || "",
    item.toolCallId || "",
    item.detailText?.length || 0,
  ].join(":")).join("|"),
  props.thinkingContentItems.map((item = {}) => [
    item.eventId || "",
    item.sequence || 0,
    String(item.content || "").length,
  ].join(":")).join("|"),
].join("::"));
const taskCheckItems = computed(() => props.taskCheckReceipts
  .map((receipt = {}, index) => ({
    key: `${String(receipt.contentHash || "task-check")}-${index}`,
    title: `${index + 1}. ${props.translate("message.taskCheck")}${receipt.timestamp ? ` · ${receipt.timestamp}` : ""}`,
    content: String(receipt.abstract || "").trim(),
  }))
  .filter((item) => item.content));
const expandedDetailKeys = ref(new Set());
function isDetailExpanded(detailKey = "") {
  return Boolean(detailKey) && expandedDetailKeys.value.has(detailKey);
}
function toggleDetail(detailKey = "") {
  if (!detailKey) return;
  const next = new Set(expandedDetailKeys.value);
  if (next.has(detailKey)) next.delete(detailKey);
  else next.add(detailKey);
  expandedDetailKeys.value = next;
}
function formatThinkingContentTitle(item = {}, index = 0) {
  const source = String(item?.source || item?.event || item?.activityKind || "thinking").trim();
  const timestamp = String(item?.timestamp || item?.timelineTimestamp || "").trim();
  return `${index + 1}. ${source}${timestamp ? ` · ${timestamp}` : ""}`;
}
watch(rendererProjectionSignature, () => {
  const buildLogPayload = () => ({
    sessionId: String(props.messageItem?.sessionId || ""),
    presentationMessageId: String(props.messageItem?.presentationMessageId || ""),
    dialogProcessId: String(props.messageItem?.dialogProcessId || ""),
    turnScopeId: String(props.messageItem?.turnScopeId || ""),
    itemCount: rendererProjection.value.length,
    thinkingContentCount: props.thinkingContentItems.length,
    thinkingContent: props.thinkingContentItems.slice(-32).map((item = {}) => ({
      eventId: String(item.eventId || ""),
      event: String(item.event || ""),
      sequence: Number(item.sequence || 0),
      contentLength: String(item.content || "").length,
    })),
    items: rendererProjection.value.slice(-32).map((item = {}, index) => {
      const detailKey = props.getDetailKey({ key: "tool-timeline" }, item, index);
      return {
        eventId: String(item.eventId || ""),
        toolCallId: String(item.toolCallId || ""),
        event: String(item.event || ""),
        hasArgs: item.args !== undefined,
        hasResult: item.result !== undefined,
        detailLength: String(item.detailText || "").length,
        detailKey,
        expanded: detailKey ? props.isExpanded(props.messageItem, detailKey) : false,
      };
    }),
  });
  logThinkingReplayDebug("frontend.thinkingReplay.detailRendererProjected", buildLogPayload);
  logStateMachineDebug("frontend.thinkingReplay.detailRendererProjected", buildLogPayload);
}, { immediate: true, flush: "post" });
</script>
<template>
  <BaseTabPanelBody class="thinking-details-panel"
    ><el-tabs class="thinking-details-tabs"
        ><el-tab-pane
          :label="translate('message.executionRecords', { count: detailCount })"
          ><BaseTabPanelBody
            class="thinking-details-scroll-body thinking-details-log-body"
            ><div
              v-for="(group, gi) in groupedToolLogs"
              :key="`tool-group-${gi}`"
              class="thinking-group"
            >
              <BaseMetaLabel
                v-if="group.label"
                class="thinking-group-title"
                :text="group.label"
              />
              <div
                v-for="(item, ii) in group.items"
                :key="getDetailKey(group, item, ii)"
              >
                <BaseThinkingLogLine
                  :indent="Number(item.indent || 0)"
                  :prefix-text="getTreePrefix(item)"
                  :event-text="item.event"
                  :content-text="item.text"
                  :detail-text="item.detailText"
                  :tool="true"
                  :expandable="Boolean(getDetailKey(group, item, ii) && item.detailText)"
                  :expanded="
                    isDetailExpanded(getDetailKey(group, item, ii))
                  "
                  :title-text="item.text || ''"
                  @toggle="
                    toggleDetail(getDetailKey(group, item, ii))
                  "
                />
              </div>
            </div>
            <BaseEmptyHint
              v-if="!detailCount"
              :text="
                translate('message.noToolCalls')
              " /></BaseTabPanelBody></el-tab-pane
        ><el-tab-pane
          :label="
            translate('message.thinkingContent', {
              count: thinkingContentItems.length,
            })
          "
          ><BaseTabPanelBody
            class="thinking-details-scroll-body thinking-details-content-body"
            ><div
              v-if="taskCheckItems.length"
              class="thinking-task-check-block"
              data-thinking-block="task-check"
            >
              <BaseMetaLabel
                class="thinking-task-check-title"
                :text="translate('message.taskCheck')"
              />
              <BaseNoteBlock
                v-for="item in taskCheckItems"
                :key="item.key"
                class="thinking-task-check-item"
                :title="item.title"
                :content="item.content"
              />
            </div><BaseNoteBlock
              v-for="(item, index) in thinkingContentItems"
              :key="`thinking-content-${String(item.eventId || index)}`"
              :title="formatThinkingContentTitle(item, index)"
              :content="String(item.content || '')" /><BaseEmptyHint
              v-if="!thinkingContentItems.length"
              :text="
                translate('message.noThinkingContent')
              " /></BaseTabPanelBody></el-tab-pane></el-tabs
  ></BaseTabPanelBody>
</template>

<style scoped>
.thinking-group {
  margin-bottom: 10px;
}
.thinking-group-title {
  margin: 8px 0 6px;
}
.thinking-task-check-block {
  flex: 0 0 auto;
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--noobot-divider);
}
.thinking-task-check-title {
  margin-bottom: 8px;
}
.thinking-task-check-item:last-child {
  margin-bottom: 0;
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
.thinking-details-content-body :deep(.base-note-block__content) {
  font-size: var(--noobot-msg-caption-font-size);
}
</style>
