<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { onMounted, watch } from "vue";
import { useWorkflowLocale } from "../i18n/index.js";
import WorkflowCardPreview from "./workflow-message-card/WorkflowCardPreview.vue";
import WorkflowNodeSessionDrawer from "./workflow-message-card/WorkflowNodeSessionDrawer.vue";
import { useWorkflowMessageCardState } from "../composables/useWorkflowMessageCardState.js";

const props = defineProps({
  messageItem: { type: Object, default: () => ({}) },
  userId: { type: String, default: "" },
  workflowSessionService: { type: Object, required: true },
  renderMarkdown: { type: Function, required: true },
  formatTime: { type: Function, required: true },
  formatFileSize: { type: Function, default: (value = 0) => `${Number(value || 0)} B` },
  isImageMime: { type: Function, default: (mimeType = "") => String(mimeType || "").startsWith("image/") },
  workflowNodeStateRegistry: { type: Object, default: null },
  subSessionMessageRegistry: { type: Object, default: null },
  subSessionMessageRegistryVersion: { type: Number, default: 0 },
  selectExecutionDetail: { type: Function, default: null },
  stopExecution: { type: Function, default: null },
  selectSessionMessages: { type: Function, default: null },
  applyWorkflowRuntimeEvent: { type: Function, default: null },
  logWorkflowDiagnostics: { type: Function, default: null },
});
const emit = defineEmits(["open-thinking-details"]);
const { translate } = useWorkflowLocale();

function logCardRender(stage) {
  const payload = props.messageItem?.pluginMeta?.payload || {};
  const content = String(props.messageItem?.content || "");
  props.logWorkflowDiagnostics?.(`frontend.workflowRender.card${stage}`, {
    sessionId: String(payload?.planningDialog?.sessionId || props.messageItem?.sessionId || ""),
    dialogProcessId: String(props.messageItem?.dialogProcessId || payload?.planningDialog?.dialogProcessId || ""),
    turnScopeId: String(props.messageItem?.turnScopeId || ""),
    workflowRunId: String(
      payload?.workflowRunId || payload?.execution?.workflowRunId || payload?.execution?.instanceId || "",
    ),
    liveProjection: props.messageItem?.__workflowLiveProjection === true,
    pluginPhase: String(props.messageItem?.pluginMeta?.phase || ""),
    contentLength: content.length,
    assistantBodyPresent: Boolean(content.trim()),
    nodeSessionCount: Array.isArray(payload?.nodeSessions) ? payload.nodeSessions.length : 0,
    presentationMessageId: String(
      props.messageItem?.presentationMessageId || props.messageItem?.messageId || props.messageItem?.id || "",
    ),
    registryWorkflowCount: Object.keys(props.workflowNodeStateRegistry?.workflows || {}).length,
  });
}

onMounted(() => logCardRender("Mounted"));
watch(() => props.messageItem, () => logCardRender("Updated"));
watch(
  () => props.subSessionMessageRegistryVersion,
  (version, previousVersion) => {
    const sessions = props.subSessionMessageRegistry?.sessions || {};
    props.logWorkflowDiagnostics?.("frontend.workflowRender.cardRegistryVersionReceived", {
      sessionId: String(props.messageItem?.sessionId || ""),
      dialogProcessId: String(props.messageItem?.dialogProcessId || ""),
      turnScopeId: String(props.messageItem?.turnScopeId || ""),
      previousVersion: Number(previousVersion || 0),
      subSessionMessageRegistryVersion: Number(version || 0),
      subSessions: Object.values(sessions).map((session = {}) => ({
        sessionId: String(session?.sessionId || session?.id || ""),
        messages: (Array.isArray(session?.messages) ? session.messages : []).map((message = {}) => ({
          id: String(message?.id || message?.messageId || ""),
          role: String(message?.role || ""),
          contentLength: String(message?.content || "").length,
        })),
      })),
    });
  },
  { immediate: true },
);

const {
  selectedExecutionId,
  executionDirectory,
  attemptExecutionIds,
  selectExecution,
  viewerVisible,
  viewerLoading,
  viewerError,
  viewerState,
  selectedRuntimeNode,
  selectedRuntimeStep,
  selectedNodeSessionId,
  runningPlaceholderViewModel,
  selectedGraphDialogProcessId,
  semanticPreviewExpanded,
  semanticFlowtos,
  flowNodes,
  semanticPreview,
  semanticPreviewLineCount,
  semanticPreviewCollapsible,
  selectedNodeSessionDocs,
  displayNodeMessages,
  turnTimingsByTurnScopeId,
  turnStatusesByTurnScopeId,
  nodeSessionAllMessages,
  selectedRuntimeBoxes,
  handleOpenThinkingDetails,
  resolveStatusLabel,
  resolveStatusClass,
  resolveStepLabel,
  resolveStateBoxLabel,
  stepHasSession,
  openNodeSession,
  openWorkflowNodePanel,
  handleRuntimeStepClick,
  handleSelectedDialogProcessUpdate,
} = useWorkflowMessageCardState(props, emit, translate);
</script>

<template>
  <WorkflowCardPreview
    v-model:semantic-preview-expanded="semanticPreviewExpanded"
    :translate="translate"
    :semantic-preview-line-count="semanticPreviewLineCount"
    :semantic-preview-collapsible="semanticPreviewCollapsible"
    :semantic-preview="semanticPreview"
    :flow-nodes="flowNodes"
    :semantic-flowtos="semanticFlowtos"
    :selected-graph-dialog-process-id="selectedGraphDialogProcessId"
    @update:selected-dialog-process-id="handleSelectedDialogProcessUpdate"
    @node-click="openWorkflowNodePanel"
    @step-click="openNodeSession"
  />

  <WorkflowNodeSessionDrawer
    v-model:viewer-visible="viewerVisible"
    :translate="translate"
    :viewer-loading="viewerLoading"
    :viewer-error="viewerError"
    :viewer-state="viewerState"
    :selected-node-session-id="selectedNodeSessionId"
    :running-placeholder-view-model="runningPlaceholderViewModel"
    :selected-execution-id="selectedExecutionId"
    :execution-directory="executionDirectory"
    :attempt-execution-ids="attemptExecutionIds"
    :stop-execution="stopExecution"
    :selected-runtime-node="selectedRuntimeNode"
    :selected-runtime-step="selectedRuntimeStep"
    :selected-runtime-boxes="selectedRuntimeBoxes"
    :selected-graph-dialog-process-id="selectedGraphDialogProcessId"
    :display-node-messages="displayNodeMessages"
    :turn-timings-by-turn-scope-id="turnTimingsByTurnScopeId"
    :turn-statuses-by-turn-scope-id="turnStatusesByTurnScopeId"
    :node-session-all-messages="nodeSessionAllMessages"
    :selected-node-session-docs="selectedNodeSessionDocs"
    :user-id="userId"
    :render-markdown="renderMarkdown"
    :format-time="formatTime"
    :format-file-size="formatFileSize"
    :is-image-mime="isImageMime"
    :resolve-state-box-label="resolveStateBoxLabel"
    :resolve-step-label="resolveStepLabel"
    :resolve-status-class="resolveStatusClass"
    :resolve-status-label="resolveStatusLabel"
    :step-has-session="stepHasSession"
    :log-workflow-diagnostics="logWorkflowDiagnostics"
    @runtime-step-click="handleRuntimeStepClick"
    @execution-select="selectExecution"
    @open-thinking-details="handleOpenThinkingDetails"
  />
</template>
