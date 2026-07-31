/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ref } from "vue";
import { useWorkflowMeta } from "./useWorkflowMeta.js";
import { useWorkflowRuntimeState } from "./useWorkflowRuntimeState.js";
import { useWorkflowNodeMessages } from "./useWorkflowNodeMessages.js";
import { useWorkflowNodeSessionViewer } from "./useWorkflowNodeSessionViewer.js";
import { useWorkflowViewerState } from "./useWorkflowViewerState.js";

export function useWorkflowMessageCardState(props, emit, translate) {
  const viewerLoading = ref(false);
  const viewerError = ref("");
  const viewerState = ref("idle");
  const selectedNodeMessages = ref([]);
  const selectedNodeRawMessages = ref([]);
  const selectedNodeSessionSummary = ref(null);
  const selectedNodeSessionId = ref("");
  const runningPlaceholderViewModel = ref(null);
  const semanticPreviewExpanded = ref(false);
  const applyingWorkflowDrawerHistory = ref(false);

  const {
    selectedExecutionId,
    executionDirectory,
    attemptExecutionIds,
    selectExecution,
    workflowMeta,
    workflowPayload,
    semanticFlowtos,
    semanticPreview,
    semanticPreviewLineCount,
    semanticPreviewCollapsible,
  } = useWorkflowMeta(props);

  const {
    viewerVisible,
    selectedNode,
    selectedRuntimeNode,
    selectedRuntimeStep,
    selectedGraphDialogProcessId,
  } = useWorkflowViewerState(workflowPayload, props.workflowNodeStateRegistry);

  const {
    nodeSessions,
    runtimeNodeSessions,
    flowNodes,
  } = useWorkflowRuntimeState(workflowPayload, {
    workflowNodeStateRegistry: props.workflowNodeStateRegistry,
  });

  const {
    selectedNodeSessionDocs,
    rawNodeSessionMessages,
    selectedNodeToolSessionDocs,
    normalizedNodeSessionMessages,
    displayNodeMessages,
    turnTimingsByTurnScopeId,
    turnStatusesByTurnScopeId,
    nodeSessionAllMessages,
    selectedRuntimeBoxes,
  } = useWorkflowNodeMessages({
    props,
    selectedNode,
    selectedRuntimeNode,
    selectedNodeMessages,
    selectedNodeRawMessages,
    selectedNodeSessionSummary,
    selectedNodeSessionId,
    runningPlaceholderViewModel,
  });

  const {
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
  } = useWorkflowNodeSessionViewer({
    props,
    emit,
    translate,
    workflowPayload,
    flowNodes,
    viewerVisible,
    viewerLoading,
    viewerError,
    viewerState,
    selectedNode,
    selectedRuntimeNode,
    selectedRuntimeStep,
    selectedNodeMessages,
    selectedNodeRawMessages,
    selectedNodeSessionSummary,
    selectedNodeSessionId,
    runningPlaceholderViewModel,
    selectedGraphDialogProcessId,
    runtimeNodeSessions,
    applyingWorkflowDrawerHistory,
    applyWorkflowRuntimeEvent: props.applyWorkflowRuntimeEvent,
  });

  return {
    selectedExecutionId,
    executionDirectory,
    attemptExecutionIds,
    selectExecution,
    viewerVisible,
    viewerLoading,
    viewerError,
    viewerState,
    selectedNode,
    selectedRuntimeNode,
    selectedRuntimeStep,
    selectedNodeMessages,
    selectedNodeRawMessages,
    selectedNodeSessionSummary,
    selectedNodeSessionId,
    selectedGraphDialogProcessId,
    semanticPreviewExpanded,
    workflowMeta,
    workflowPayload,
    nodeSessions,
    runtimeNodeSessions,
    semanticFlowtos,
    flowNodes,
    semanticPreview,
    semanticPreviewLineCount,
    semanticPreviewCollapsible,
    selectedNodeSessionDocs,
    rawNodeSessionMessages,
    selectedNodeToolSessionDocs,
    normalizedNodeSessionMessages,
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
  };
}
