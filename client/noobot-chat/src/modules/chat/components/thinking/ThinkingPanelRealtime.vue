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
  BasePillButton,
  BaseTabPanelBody,
  BaseThinkingLogLine,
  BaseThinkingPanelShell,
} from "../../../../shared/public-api/ui.js";
import {
  logToolLogWindowDebug,
  summarizeToolLogWindow,
} from "../../../debug/loggers/toolLogWindowDebugLogger.js";
const props = defineProps({
  messageItem: { type: Object, required: true },
  translate: { type: Function, required: true },
  thinkingDurationLabel: { type: String, default: "0s" },
  isRunning: Boolean,
  latestPluginAnalysisLog: { type: Object, default: null },
  latestMainModelContentLog: { type: Object, default: null },
  executionLogs: { type: Array, default: () => [] },
  executionLogCount: { type: Number, default: 0 },
  thinkingDetailLabel: { type: String, default: "" },
  openNames: { type: Array, default: () => [] },
});
const emit = defineEmits(["open-thinking-details", "collapse", "update:openNames"]);
const runningEmptyHintKey = computed(() =>
  props.latestPluginAnalysisLog || props.latestMainModelContentLog
    ? "message.analyzingRealtimeLog"
    : "message.waitingRealtimeLog",
);
const executionLogSignature = computed(() => {
  const logs = Array.isArray(props.executionLogs) ? props.executionLogs : [];
  const last = logs.at(-1) || {};
  return [
    logs.length,
    last.eventId || last.id || "",
    last.sequence ?? last.seq ?? "",
    last.toolCallId || last.tool_call_id || "",
    String(last.text || "").length,
  ].join("|");
});
function executionLogKey(logItem = {}, logIndex = 0) {
  const eventId = String(logItem.eventId || logItem.id || "").trim();
  if (eventId) return `event:${eventId}`;
  const toolCallId = String(logItem.toolCallId || logItem.tool_call_id || "").trim();
  const event = String(logItem.event || logItem.type || "log").trim();
  const sequence = logItem.sequence ?? logItem.seq ?? "";
  return toolCallId || sequence !== ""
    ? `${event}:${toolCallId}:${sequence}`
    : `${event}:${String(logItem.timestamp || logItem.ts || "")}:${logIndex}`;
}
watch(
  executionLogSignature,
  () => {
    const executionLogs = props.executionLogs;
    logToolLogWindowDebug("frontend.toolLogWindow.rendererReceived", {
      sessionId: String(props.messageItem?.sessionId || ""),
      dialogProcessId: String(props.messageItem?.dialogProcessId || ""),
      turnScopeId: String(props.messageItem?.turnScopeId || ""),
      running: props.isRunning,
      declaredExecutionLogCount: props.executionLogCount,
      receivedCount: Array.isArray(executionLogs) ? executionLogs.length : 0,
      received: summarizeToolLogWindow(executionLogs),
    });
  },
  { immediate: true },
);
</script>
<template>
  <BaseThinkingPanelShell
    :model-value="openNames"
    @update:model-value="emit('update:openNames', $event)"
    item-name="thinking-panel"
    class="thinking-realtime-shell"
    :class="{ 'is-running': isRunning }"
  >
    <template #title>
      <div class="thinking-title-row">
        <span class="thinking-elapsed noobot-flat-chip">{{
          translate("message.thinkingElapsed", {
            duration: thinkingDurationLabel,
          })
        }}</span>
      </div>
    </template>
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
          :key="executionLogKey(logItem, logIndex)"
        >
          <BaseThinkingLogLine
            :event-text="logItem.type || logItem.event"
            :content-text="logItem.text"
          />
        </div>
        <BaseEmptyHint
          v-if="!executionLogCount && isRunning"
          :text="translate(runningEmptyHintKey)"
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
  display: flex;
  align-items: center;
  width: 100%;
}

.thinking-realtime-shell.is-running {
  border: none;
  background: transparent;
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
