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
import { logStateMachineDebug } from "../../../debug/loggers/stateMachineLogger.js";
import { toolLogDetailKey } from "../../model/toolLogIdentity.js";
const props = defineProps({
  messageItem: { type: Object, required: true },
  translate: { type: Function, required: true },
  thinkingDurationLabel: { type: String, default: "0s" },
  isRunning: Boolean,
  latestPluginAnalysisLog: { type: Object, default: null },
  latestMainModelContentLog: { type: Object, default: null },
  executionLogs: { type: Array, default: () => [] },
  executionLogCount: { type: Number, default: 0 },
  taskCheckReceipt: { type: Object, default: null },
  thinkingDetailLabel: { type: String, default: "" },
  openNames: { type: Array, default: () => [] },
  getDetailKey: { type: Function, required: true },
  isExpanded: { type: Function, required: true },
  toggleExpanded: { type: Function, required: true },
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
    last.eventId || "",
    last.sequence ?? "",
    last.toolCallId || "",
    String(last.text || "").length,
    String(last.detailText || "").length,
  ].join("|");
});
function executionLogKey(logItem = {}) {
  const toolKey = toolLogDetailKey(logItem);
  if (toolKey) return toolKey;
  const eventId = String(logItem.eventId || "").trim();
  return eventId ? `event:${eventId}` : "";
}
function isToolLog(logItem = {}) {
  return ["tool_call", "tool_result"].includes(String(logItem.event || "").trim());
}
function detailKey(logItem = {}) {
  return isToolLog(logItem) ? props.getDetailKey({ key: "tool-timeline" }, logItem) : "";
}
function isExpandable(logItem = {}) {
  return Boolean(detailKey(logItem) && String(logItem.detailText || ""));
}
watch(
  executionLogSignature,
  () => {
    logToolLogWindowDebug("frontend.toolLogWindow.rendererReceived", () => {
      const executionLogs = props.executionLogs;
      return {
      sessionId: String(props.messageItem?.sessionId || ""),
      dialogProcessId: String(props.messageItem?.dialogProcessId || ""),
      turnScopeId: String(props.messageItem?.turnScopeId || ""),
      running: props.isRunning,
      declaredExecutionLogCount: props.executionLogCount,
      receivedCount: Array.isArray(executionLogs) ? executionLogs.length : 0,
      received: summarizeToolLogWindow(executionLogs),
      };
    });
    logStateMachineDebug("frontend.thinkingReplay.realtimeRendererProjected", () => ({
      sessionId: String(props.messageItem?.sessionId || ""),
      presentationMessageId: String(props.messageItem?.presentationMessageId || ""),
      dialogProcessId: String(props.messageItem?.dialogProcessId || ""),
      turnScopeId: String(props.messageItem?.turnScopeId || ""),
      running: props.isRunning,
      declaredExecutionLogCount: props.executionLogCount,
      receivedCount: Array.isArray(props.executionLogs) ? props.executionLogs.length : 0,
      received: summarizeToolLogWindow(props.executionLogs),
      items: (Array.isArray(props.executionLogs) ? props.executionLogs : []).slice(-32)
        .map((item = {}) => {
          const key = detailKey(item);
          const expandable = isExpandable(item);
          return {
            eventId: String(item.eventId || ""),
            toolCallId: String(item.toolCallId || ""),
            event: String(item.event || ""),
            detailKey: key,
            detailLength: String(item.detailText || "").length,
            expandable,
            expanded: expandable && props.isExpanded(props.messageItem, key),
          };
        }),
    }));
  },
  { immediate: true, flush: "post" },
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
      <div
        v-if="taskCheckReceipt"
        class="thinking-analysis-block thinking-task-check-block"
        data-thinking-block="task-check"
      >
        <BaseMetaLabel
          class="thinking-analysis-title"
          :text="translate('message.taskCheck')"
        /><BaseNoteBlock :content="taskCheckReceipt.abstract" />
      </div>
      <div class="thinking-realtime-log-stream">
        <div
          v-for="logItem in executionLogs"
          :key="executionLogKey(logItem)"
        >
          <BaseThinkingLogLine
            :event-text="logItem.event"
            :content-text="logItem.text"
            :detail-text="logItem.detailText"
            :tool="isToolLog(logItem)"
            :expandable="isExpandable(logItem)"
            :expanded="isExpanded(messageItem, detailKey(logItem))"
            @toggle="toggleExpanded(messageItem, detailKey(logItem))"
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
