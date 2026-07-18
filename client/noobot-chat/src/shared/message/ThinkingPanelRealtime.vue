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
  BasePillButton,
  BaseSectionHeader,
  BaseTabPanelBody,
  BaseThinkingLogLine,
  BaseThinkingPanelShell,
} from "../ui";
defineProps({
  messageItem: { type: Object, required: true },
  translate: { type: Function, required: true },
  thinkingDurationLabel: { type: String, default: "0s" },
  isRunning: Boolean,
  latestPluginAnalysisLog: { type: Object, default: null },
  latestMainModelContentLog: { type: Object, default: null },
  executionLogs: { type: Array, default: () => [] },
  executionLogCount: { type: Number, default: 0 },
  thinkingDetailLabel: { type: String, default: "" },
});
const emit = defineEmits(["open-thinking-details", "collapse"]);
</script>
<template>
  <BaseThinkingPanelShell
    v-model="messageItem.thinkingOpenNames"
    item-name="thinking-panel"
    class="thinking-realtime-shell"
    :class="{ 'is-running': isRunning }"
  >
    <template #title
      ><BaseSectionHeader
        :title="translate('message.thinkingExpand')"
        class="thinking-title-row"
        ><template #extra
          ><span class="thinking-elapsed noobot-flat-chip">{{
            translate("message.thinkingElapsed", {
              duration: thinkingDurationLabel,
            })
          }}</span></template
        ></BaseSectionHeader
      ></template
    >
    <BaseTabPanelBody class="thinking-realtime-body">
      <div v-if="latestPluginAnalysisLog" class="thinking-analysis-block">
        <BaseMetaLabel
          class="thinking-analysis-title"
          text="分析流程"
        /><BaseNoteBlock :content="latestPluginAnalysisLog.output" />
      </div>
      <div v-if="latestMainModelContentLog" class="thinking-analysis-block">
        <BaseMetaLabel
          class="thinking-analysis-title"
          text="模型分析"
        /><BaseNoteBlock :content="latestMainModelContentLog.output" />
      </div>
      <div class="thinking-realtime-log-stream">
        <div
          v-for="(logItem, logIndex) in executionLogs"
          :key="`realtime-${logIndex}`"
        >
          <BaseThinkingLogLine
            :event-text="logItem.type || logItem.event"
            :content-text="logItem.text"
          />
        </div>
        <BaseEmptyHint
          v-if="!executionLogCount && isRunning"
          :text="translate('message.waitingRealtimeLog')"
        /><BaseEmptyHint
          v-if="!executionLogCount && !isRunning"
          :text="translate('message.noExecutionLogs')"
        />
      </div>
      <div class="thinking-execution-actions">
        <BasePillButton
          class="thinking-detail-action-button noobot-primary-pill-action"
          :label="thinkingDetailLabel"
          @click="emit('open-thinking-details')"
        />
      </div>
    </BaseTabPanelBody>
    <template #footer
      ><BasePillButton
        :label="translate('message.collapse')"
        @click="emit('collapse')"
    /></template>
  </BaseThinkingPanelShell>
</template>

<style scoped>
.thinking-title-row {
  width: 100%;
}
.thinking-title-row :deep(.base-section-header__title) {
  color: var(--noobot-thinking-header);
  font-weight: 600;
}

.thinking-realtime-shell.is-running {
  border: 1px solid color-mix(in srgb, var(--el-color-primary) 55%, var(--noobot-panel-border));
  background: color-mix(in srgb, var(--el-color-primary) 10%, var(--noobot-thinking-bg));
  box-shadow: 0 4px 16px color-mix(in srgb, var(--el-color-primary) 16%, transparent);
  animation: thinking-running-card-glow 2.4s ease-in-out infinite;
}

@keyframes thinking-running-card-glow {
  0%, 100% {
    border-color: color-mix(in srgb, var(--el-color-primary) 48%, var(--noobot-panel-border));
  }
  50% {
    border-color: color-mix(in srgb, var(--el-color-primary) 72%, var(--noobot-panel-border));
  }
}

@media (prefers-reduced-motion: reduce) {
  .thinking-realtime-shell.is-running {
    animation: none;
  }
}

.thinking-elapsed {
  font-size: var(--noobot-font-size-xs);
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
</style>
