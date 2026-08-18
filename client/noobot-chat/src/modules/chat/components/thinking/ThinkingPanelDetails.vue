<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, nextTick, ref, watch } from "vue";
import {
  observeElementOffset,
  observeElementRect,
  useVirtualizer,
} from "@tanstack/vue-virtual";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import {
  BaseEmptyHint,
  BaseMetaLabel,
  BaseNoteBlock,
  BaseTabPanelBody,
  BaseThinkingLogLine,
} from "../../../../shared/public-api/ui.js";
import {
  isThinkingReplayDebugEnabled,
  logThinkingReplayDebug,
} from "../../../debug/loggers/thinkingReplayDebugLogger.js";
import {
  isStateMachineDebugEnabled,
  logStateMachineDebug,
} from "../../../debug/loggers/stateMachineLogger.js";
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
const DETAIL_TAB = Object.freeze({
  EXECUTION: "execution",
  THINKING: "thinking",
});
const activeDetailTab = ref(DETAIL_TAB.EXECUTION);
const rendererProjection = computed(() =>
  (Array.isArray(props.groupedToolLogs) ? props.groupedToolLogs : []).flatMap((group = {}) =>
    (Array.isArray(group.items) ? group.items : []).map((item, itemIndex) => ({
      detailKey: props.getDetailKey(group, item, itemIndex),
      group,
      item,
      itemIndex,
    })),
  ),
);
const toolScrollElement = ref(null);
let pendingInitialScrollAlignment = true;
let publishToolScrollRect = null;
let publishToolScrollOffset = null;
function observeToolScrollRect(instance, callback) {
  const publish = (rect) => {
    if (rect.height <= 0) return;
    if (pendingInitialScrollAlignment && instance.scrollElement) {
      instance.scrollElement.scrollTop = 0;
    }
    callback(rect);
    pendingInitialScrollAlignment = false;
  };
  publishToolScrollRect = publish;
  const cleanup = observeElementRect(instance, publish);
  return () => {
    if (publishToolScrollRect === publish) publishToolScrollRect = null;
    cleanup?.();
  };
}
function observeToolScrollOffset(instance, callback) {
  const publish = (offset, isScrolling = false) => callback(offset, isScrolling);
  publishToolScrollOffset = publish;
  const cleanup = observeElementOffset(instance, publish);
  return () => {
    if (publishToolScrollOffset === publish) publishToolScrollOffset = null;
    cleanup?.();
  };
}
const toolVirtualizer = useVirtualizer(
  computed(() => ({
    count: rendererProjection.value.length,
    estimateSize: () => QUANTITY_THRESHOLDS.client.thinkingDetailEstimatedRowHeightPx,
    getItemKey: (index) => rendererProjection.value[index].detailKey,
    getScrollElement: () => toolScrollElement.value,
    initialRect: {
      height: QUANTITY_THRESHOLDS.client.thinkingDetailInitialViewportHeightPx,
      width: 0,
    },
    observeElementRect: observeToolScrollRect,
    observeElementOffset: observeToolScrollOffset,
    overscan: QUANTITY_THRESHOLDS.client.thinkingDetailVirtualOverscan,
  })),
);
const virtualToolRows = computed(() => toolVirtualizer.value.getVirtualItems());
const virtualToolHeight = computed(() => toolVirtualizer.value.getTotalSize());
function measureToolRow(element) {
  if (element) toolVirtualizer.value.measureElement(element);
}
const detailTimelineIdentity = computed(() =>
  [
    props.messageItem?.sessionId,
    props.messageItem?.turnScopeId,
    props.messageItem?.dialogProcessId,
    props.messageItem?.presentationMessageId,
  ]
    .map((value) => String(value || "").trim())
    .join("::"),
);
async function synchronizeToolViewport({ alignStart = false } = {}) {
  if (alignStart) pendingInitialScrollAlignment = true;
  await nextTick();
  const scrollElement = toolScrollElement.value;
  if (!scrollElement) return;
  const scrollOffset = alignStart ? 0 : Math.max(0, scrollElement.scrollTop);
  if (alignStart) scrollElement.scrollTop = 0;
  publishToolScrollOffset?.(scrollOffset, false);
  if (scrollElement.clientHeight <= 0) return;
  publishToolScrollRect?.({
    width: scrollElement.clientWidth,
    height: scrollElement.clientHeight,
  });
  toolVirtualizer.value.measure();
  toolVirtualizer.value.scrollToOffset(scrollOffset, { align: "start" });
  pendingInitialScrollAlignment = false;
}
watch(
  activeDetailTab,
  (tab) => {
    if (tab === DETAIL_TAB.EXECUTION) void synchronizeToolViewport();
  },
  { flush: "post" },
);
watch(
  detailTimelineIdentity,
  () => void synchronizeToolViewport({ alignStart: true }),
  { immediate: true, flush: "post" },
);
watch(
  () => rendererProjection.value.length,
  (count, previousCount) => {
    if (count > 0 && previousCount === 0) {
      void synchronizeToolViewport({ alignStart: true });
    }
  },
  { flush: "post" },
);
const rendererProjectionSignature = computed(() =>
  !isThinkingReplayDebugEnabled() && !isStateMachineDebugEnabled()
    ? "disabled"
    : [
        rendererProjection.value
          .map(({ item = {} }) =>
            [item.eventId || "", item.toolCallId || "", item.detailText?.length || 0].join(":"),
          )
          .join("|"),
        props.thinkingContentItems
          .map((item = {}) =>
            [item.eventId || "", item.sequence || 0, String(item.content || "").length].join(":"),
          )
          .join("|"),
      ].join("::"),
);
const taskCheckItems = computed(() =>
  props.taskCheckReceipts
    .map((receipt = {}, index) => ({
      key: `${String(receipt.contentHash || "task-check")}-${index}`,
      title: `${index + 1}. ${props.translate("message.taskCheck")}${receipt.timestamp ? ` · ${receipt.timestamp}` : ""}`,
      content: String(receipt.abstract || "").trim(),
    }))
    .filter((item) => item.content),
);
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
watch(
  rendererProjectionSignature,
  () => {
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
      items: rendererProjection.value.slice(-32).map(({ detailKey, item = {} }) => {
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
  },
  { immediate: true, flush: "post" },
);
</script>
<template>
  <BaseTabPanelBody class="thinking-details-panel"
    ><el-tabs v-model="activeDetailTab" class="thinking-details-tabs"
      ><el-tab-pane
        :label="translate('message.executionRecords', { count: detailCount })"
        :name="DETAIL_TAB.EXECUTION"
        ><div
          ref="toolScrollElement"
          class="thinking-details-scroll-body thinking-details-log-body"
        >
          <div class="thinking-tool-virtual-space" :style="{ height: `${virtualToolHeight}px` }">
            <div
              v-for="virtualRow in virtualToolRows"
              :key="virtualRow.key"
              :ref="measureToolRow"
              :data-index="virtualRow.index"
              class="thinking-tool-row"
              :style="{ transform: `translateY(${virtualRow.start}px)` }"
            >
              <BaseThinkingLogLine
                :indent="Number(rendererProjection[virtualRow.index].item.indent || 0)"
                :prefix-text="getTreePrefix(rendererProjection[virtualRow.index].item)"
                :event-text="rendererProjection[virtualRow.index].item.event"
                :content-text="rendererProjection[virtualRow.index].item.text"
                :detail-text="rendererProjection[virtualRow.index].item.detailText"
                :detail-value="rendererProjection[virtualRow.index].item.detailValue"
                :tool="true"
                :tone="rendererProjection[virtualRow.index].item.presentation?.tone"
                :tool-name="rendererProjection[virtualRow.index].item.tool"
                :risk-level="rendererProjection[virtualRow.index].item.riskLevel"
                :expandable="
                  Boolean(
                    rendererProjection[virtualRow.index].detailKey &&
                    (rendererProjection[virtualRow.index].item.detailText ||
                      rendererProjection[virtualRow.index].item.detailValue !== undefined),
                  )
                "
                :expanded="isDetailExpanded(rendererProjection[virtualRow.index].detailKey)"
                :title-text="rendererProjection[virtualRow.index].item.text || ''"
                @toggle="toggleDetail(rendererProjection[virtualRow.index].detailKey)"
              />
            </div>
          </div>
          <BaseEmptyHint
            v-if="!detailCount"
            :text="translate('message.noToolCalls')"
          /></div></el-tab-pane
      ><el-tab-pane
        :name="DETAIL_TAB.THINKING"
        :label="
          translate('message.thinkingContent', {
            count: thinkingContentItems.length,
          })
        "
        ><BaseTabPanelBody class="thinking-details-scroll-body thinking-details-content-body"
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
          </div>
          <BaseNoteBlock
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
.thinking-tool-virtual-space {
  position: relative;
  width: 100%;
}
.thinking-tool-row {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
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
  overflow-anchor: none;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
.thinking-details-content-body :deep(.base-note-block__content) {
  font-size: var(--noobot-msg-caption-font-size);
}
</style>
