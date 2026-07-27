<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { onMounted, watch } from "vue";
import { useWorkflowLocale } from "../i18n.js";
import WorkflowCardPreview from "./workflow-message-card/WorkflowCardPreview.vue";
import WorkflowNodeSessionDrawer from "./workflow-message-card/WorkflowNodeSessionDrawer.vue";
import { useWorkflowMessageCardState } from "./workflow-message-card/useWorkflowMessageCardState.js";

const props = defineProps({
  messageItem: { type: Object, default: () => ({}) },
  userId: { type: String, default: "" },
  workflowSessionService: { type: Object, required: true },
  renderMarkdown: { type: Function, required: true },
  formatTime: { type: Function, required: true },
  formatFileSize: { type: Function, default: (value = 0) => `${Number(value || 0)} B` },
  isImageMime: { type: Function, default: (mimeType = "") => String(mimeType || "").startsWith("image/") },
  workflowNodeStateRegistry: { type: Object, default: null },
  selectExecutionDetail: { type: Function, default: null },
  stopExecution: { type: Function, default: null },
  selectSessionMessages: { type: Function, default: null },
  mergeSubSessionSnapshot: { type: Function, default: null },
  logWorkflowDiagnostics: { type: Function, default: null },
});
const emit = defineEmits(["open-thinking-details"]);
const { translate } = useWorkflowLocale();

function logCardRender(stage) {
  const payload = props.messageItem?.pluginMeta?.payload || {};
  props.logWorkflowDiagnostics?.(`frontend.workflowRender.card${stage}`, {
    sessionId: String(payload?.planningDialog?.sessionId || props.messageItem?.sessionId || ""),
    dialogProcessId: String(props.messageItem?.dialogProcessId || payload?.planningDialog?.dialogProcessId || ""),
    turnScopeId: String(props.messageItem?.turnScopeId || ""),
    workflowRunId: String(
      payload?.workflowRunId || payload?.execution?.workflowRunId || payload?.execution?.instanceId || "",
    ),
    liveProjection: props.messageItem?.__workflowLiveProjection === true,
    nodeSessionCount: Array.isArray(payload?.nodeSessions) ? payload.nodeSessions.length : 0,
    registryWorkflowCount: Object.keys(props.workflowNodeStateRegistry?.workflows || {}).length,
  });
}

onMounted(() => logCardRender("Mounted"));
watch(() => props.messageItem, () => logCardRender("Updated"));

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
  selectedGraphDialogProcessId,
  semanticPreviewExpanded,
  semanticFlowtos,
  flowNodes,
  semanticPreview,
  semanticPreviewLineCount,
  semanticPreviewCollapsible,
  selectedNodeSessionDocs,
  displayNodeMessages,
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
    :selected-execution-id="selectedExecutionId"
    :execution-directory="executionDirectory"
    :attempt-execution-ids="attemptExecutionIds"
    :stop-execution="stopExecution"
    :selected-runtime-node="selectedRuntimeNode"
    :selected-runtime-step="selectedRuntimeStep"
    :selected-runtime-boxes="selectedRuntimeBoxes"
    :selected-graph-dialog-process-id="selectedGraphDialogProcessId"
    :display-node-messages="displayNodeMessages"
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
    @runtime-step-click="handleRuntimeStepClick"
    @execution-select="selectExecution"
    @open-thinking-details="handleOpenThinkingDetails"
  />
</template>
