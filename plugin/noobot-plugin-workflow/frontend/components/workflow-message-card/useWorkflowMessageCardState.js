/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ref } from "vue";
import { useWorkflowMeta } from "./useWorkflowMeta";
import { useWorkflowRuntimeState } from "./useWorkflowRuntimeState";
import { useWorkflowNodeMessages } from "./useWorkflowNodeMessages";
import { useWorkflowNodeSessionViewer } from "./useWorkflowNodeSessionViewer";
import { useWorkflowViewerState } from "./useWorkflowViewerState";

export function useWorkflowMessageCardState(props, emit, translate) {
  const viewerLoading = ref(false);
  const viewerError = ref("");
  const viewerState = ref("idle");
  const selectedNodeMessages = ref([]);
  const selectedNodeRawMessages = ref([]);
  const selectedNodeSessionSummary = ref(null);
  const selectedNodeSessionId = ref("");
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
    selectedGraphDialogProcessId,
    runtimeNodeSessions,
    applyingWorkflowDrawerHistory,
    mergeSubSessionSnapshot: props.mergeSubSessionSnapshot,
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
