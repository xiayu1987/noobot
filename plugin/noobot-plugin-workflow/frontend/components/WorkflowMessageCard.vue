<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { onMounted, watch } from "vue";
import { text } from "@noobot/shared/value";
import { useWorkflowLocale } from "../i18n/index.js";
import WorkflowCardPreview from "./workflow-message-card/WorkflowCardPreview.vue";
import WorkflowNodeSessionDrawer from "./workflow-message-card/WorkflowNodeSessionDrawer.vue";
import { useWorkflowMessageCardState } from "../composables/useWorkflowMessageCardState.js";

const props = defineProps({
  messageItem: { type: Object, required: true },
  userId: { type: String, default: "" },
  workflowSessionService: { type: Object, required: true },
  renderMarkdown: { type: Function, required: true },
  formatTime: { type: Function, required: true },
  formatFileSize: { type: Function, required: true },
  isImageMime: { type: Function, required: true },
  workflowNodeStateRegistry: { type: Object, required: true },
  subSessionMessageRegistry: { type: Object, required: true },
  subSessionMessageRegistryVersion: { type: Number, required: true },
  selectExecutionDetail: { type: Function, required: true },
  stopExecution: { type: Function, required: true },
  selectSessionMessages: { type: Function, required: true },
  applyWorkflowRuntimeEvent: { type: Function, required: true },
  logWorkflowDiagnostics: { type: Function, required: true },
});
const emit = defineEmits(["open-thinking-details"]);
const { translate } = useWorkflowLocale();

function logCardRender(stage) {
  const { payload } = props.messageItem.pluginMeta;
  const content = text(props.messageItem.content);
  props.logWorkflowDiagnostics(`frontend.workflowRender.card${stage}`, {
    sessionId: payload.runMeta.sessionId,
    dialogProcessId: payload.runMeta.dialogProcessId,
    turnScopeId: props.messageItem.turnScopeId,
    workflowRunId: payload.workflowRunId,
    liveProjection: props.messageItem.__workflowLiveProjection === true,
    pluginPhase: props.messageItem.pluginMeta.phase,
    contentLength: content.length,
    assistantBodyPresent: Boolean(content.trim()),
    nodeSessionCount: payload.nodeSessions.length,
    presentationMessageId: text(props.messageItem.presentationMessageId),
    registryWorkflowCount: Object.keys(props.workflowNodeStateRegistry.workflows).length,
  });
}

onMounted(() => logCardRender("Mounted"));
watch(
  () => props.messageItem,
  () => logCardRender("Updated"),
);
watch(
  () => props.subSessionMessageRegistryVersion,
  (version, previousVersion) => {
    props.logWorkflowDiagnostics("frontend.workflowRender.cardRegistryVersionReceived", {
      sessionId: text(props.messageItem.sessionId),
      dialogProcessId: text(props.messageItem.dialogProcessId),
      turnScopeId: text(props.messageItem.turnScopeId),
      previousVersion,
      subSessionMessageRegistryVersion: version,
      subSessions: Object.values(props.subSessionMessageRegistry.sessions).map((session) => ({
        sessionId: session.sessionId,
        messages: session.messages.map((message) => ({
          messageUid: text(message.messageUid),
          presentationMessageId: text(message.presentationMessageId),
          role: text(message.role),
          contentLength: text(message.content).length,
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
  selectedNodeSessionDocs,
  displayNodeMessages,
  nodeSessionAllMessages,
  selectedActionNodeStates,
  fetchSelectedNodeExecutionReport,
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
    :fetch-execution-report="fetchSelectedNodeExecutionReport"
    :selected-runtime-node="selectedRuntimeNode"
    :selected-runtime-step="selectedRuntimeStep"
    :selected-action-node-states="selectedActionNodeStates"
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
    :log-workflow-diagnostics="logWorkflowDiagnostics"
    @runtime-step-click="handleRuntimeStepClick"
    @execution-select="selectExecution"
    @open-thinking-details="handleOpenThinkingDetails"
  />
</template>
