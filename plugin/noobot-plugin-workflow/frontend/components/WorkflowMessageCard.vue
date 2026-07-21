<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { useWorkflowLocale } from "../i18n";
import WorkflowCardPreview from "./workflow-message-card/WorkflowCardPreview.vue";
import WorkflowNodeSessionDrawer from "./workflow-message-card/WorkflowNodeSessionDrawer.vue";
import { useWorkflowMessageCardState } from "./workflow-message-card/useWorkflowMessageCardState";

const props = defineProps({
  messageItem: { type: Object, default: () => ({}) },
  userId: { type: String, default: "" },
  authFetch: { type: Function, default: null },
  renderMarkdown: { type: Function, required: true },
  formatTime: { type: Function, required: true },
  formatFileSize: { type: Function, default: (value = 0) => `${Number(value || 0)} B` },
  isImageMime: { type: Function, default: (mimeType = "") => String(mimeType || "").startsWith("image/") },
  workflowNodeStateRegistry: { type: Object, default: null },
  turnRuntimeRegistry: { type: Object, default: null },
  workflowRuntimeProjectionVersion: { type: String, default: "" },
  selectExecutionDetail: { type: Function, default: null },
  stopExecution: { type: Function, default: null },
  selectSessionMessages: { type: Function, default: null },
  mergeSubSessionSnapshot: { type: Function, default: null },
});
const emit = defineEmits(["open-thinking-details"]);
const { translate } = useWorkflowLocale();

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
  selectedNodeSessionId,
  selectedGraphDialogProcessId,
  semanticPreviewExpanded,
  semanticFlowtos,
  flowNodes,
  semanticPreview,
  semanticPreviewLineCount,
  semanticPreviewCollapsible,
  selectedNodeSessionDocs,
  selectedNodeTurnTimingsByTurnScopeId,
  selectedNodeTurnStatuses,
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
    :selected-runtime-boxes="selectedRuntimeBoxes"
    :selected-graph-dialog-process-id="selectedGraphDialogProcessId"
    :display-node-messages="displayNodeMessages"
    :node-session-all-messages="nodeSessionAllMessages"
    :selected-node-session-docs="selectedNodeSessionDocs"
    :turn-timings-by-turn-scope-id="selectedNodeTurnTimingsByTurnScopeId"
    :turn-statuses="selectedNodeTurnStatuses"
    :user-id="userId"
    :auth-fetch="authFetch"
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
