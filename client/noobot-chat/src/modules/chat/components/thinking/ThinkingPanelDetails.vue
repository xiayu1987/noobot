<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, watch } from "vue";
import {
  BaseEmptyHint,
  BaseMetaLabel,
  BaseNoteBlock,
  BaseTabPanelBody,
  BaseThinkingLogLine,
} from "../../../../shared/public-api/ui.js";
import { logStateMachineDebug } from "../../../debug/loggers/stateMachineLogger.js";
const props = defineProps({
  messageItem: { type: Object, required: true },
  translate: { type: Function, required: true },
  isRunning: Boolean,
  groupedToolLogs: { type: Array, default: () => [] },
  injectedMessages: { type: Array, default: () => [] },
  detailCount: { type: Number, default: 0 },
  getTreePrefix: { type: Function, required: true },
  getDetailKey: { type: Function, required: true },
  isExpanded: { type: Function, required: true },
  toggleExpanded: { type: Function, required: true },
  formatInjectedTitle: { type: Function, required: true },
});
const rendererProjection = computed(() => (Array.isArray(props.groupedToolLogs)
  ? props.groupedToolLogs
  : []).flatMap((group = {}) => (Array.isArray(group.items) ? group.items : [])));
const rendererProjectionSignature = computed(() => rendererProjection.value.map((item = {}) => [
  item.eventId || "",
  item.toolCallId || "",
  item.detailText?.length || 0,
].join(":")).join("|"));
watch(rendererProjectionSignature, () => {
  logStateMachineDebug("frontend.thinkingReplay.detailRendererProjected", () => ({
    sessionId: String(props.messageItem?.sessionId || ""),
    presentationMessageId: String(props.messageItem?.presentationMessageId || ""),
    dialogProcessId: String(props.messageItem?.dialogProcessId || ""),
    turnScopeId: String(props.messageItem?.turnScopeId || ""),
    itemCount: rendererProjection.value.length,
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
  }));
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
                    isExpanded(messageItem, getDetailKey(group, item, ii))
                  "
                  :title-text="item.text || ''"
                  @toggle="
                    toggleExpanded(messageItem, getDetailKey(group, item, ii))
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
              count: injectedMessages.length,
            })
          "
          ><BaseTabPanelBody
            class="thinking-details-scroll-body thinking-details-injected-body"
            ><BaseNoteBlock
              v-for="(item, index) in injectedMessages"
              :key="`detail-injected-${index}-${String(item.ts || '')}`"
              :title="formatInjectedTitle(item, index)"
              :content="String(item.content || '')" /><BaseEmptyHint
              v-if="!injectedMessages.length"
              :text="
                translate('message.noInjectedMessages')
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
.thinking-details-injected-body :deep(.base-note-block__content) {
  font-size: var(--noobot-msg-caption-font-size);
}
</style>
