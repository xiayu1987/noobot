<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import {
  BaseEmptyHint,
  BaseMetaLabel,
  BaseNoteBlock,
  BaseTabPanelBody,
  BaseThinkingLogLine,
} from "../ui";
const props = defineProps({
  messageItem: { type: Object, required: true },
  translate: { type: Function, required: true },
  isRunning: Boolean,
  detailLabel: { type: String, default: "" },
  groupedToolLogs: { type: Array, default: () => [] },
  injectedMessages: { type: Array, default: () => [] },
  detailCount: { type: Number, default: 0 },
  getTreePrefix: { type: Function, required: true },
  getDetailKey: { type: Function, required: true },
  isExpanded: { type: Function, required: true },
  toggleExpanded: { type: Function, required: true },
  formatInjectedTitle: { type: Function, required: true },
});
</script>
<template>
  <BaseTabPanelBody class="thinking-details-panel"
    ><template v-if="!isRunning"
      ><el-tabs class="thinking-details-tabs"
        ><el-tab-pane :label="detailLabel"
          ><BaseTabPanelBody
            class="thinking-details-scroll-body thinking-details-log-body"
            ><div
              v-for="(group, gi) in groupedToolLogs"
              :key="`tool-group-${gi}`"
              class="thinking-group"
            >
              <BaseMetaLabel class="thinking-group-title" :text="group.label" />
              <div
                v-for="(item, ii) in group.items"
                :key="`tool-log-${gi}-${ii}`"
              >
                <BaseThinkingLogLine
                  :indent="Number(item.indent || 0)"
                  :prefix-text="getTreePrefix(item)"
                  :event-text="item.type || item.event"
                  :content-text="item.text"
                  :tool="true"
                  :expandable="true"
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
            translate('message.injectedMessages', {
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
              " /></BaseTabPanelBody></el-tab-pane></el-tabs></template
    ><BaseEmptyHint v-else :text="translate('message.detailsAfterDone')"
  /></BaseTabPanelBody>
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
