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
  const selectedNodeSessionMetadata = ref(null);
  const selectedNodeSessionId = ref("");
  const runningPlaceholderViewModel = ref(null);
  const semanticPreviewExpanded = ref(false);

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
  } = useWorkflowMeta(props);

  const {
    viewerVisible,
    selectedNode,
    selectedRuntimeNode,
    selectedRuntimeStep,
    selectedGraphDialogProcessId,
  } = useWorkflowViewerState(workflowPayload, props.workflowNodeStateRegistry);

  const { nodeSessions, runtimeNodeSessions, flowNodes } = useWorkflowRuntimeState(
    workflowPayload,
    {
      workflowNodeStateRegistry: props.workflowNodeStateRegistry,
    },
  );

  const { selectedNodeSessionDocs, displayNodeMessages, selectedActionNodeStates } =
    useWorkflowNodeMessages({
      props,
      selectedNode,
      selectedRuntimeNode,
      selectedNodeMessages,
      selectedNodeSessionMetadata,
      selectedNodeSessionId,
      runningPlaceholderViewModel,
    });

  const {
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
  } = useWorkflowNodeSessionViewer({
    props,
    emit,
    translate,
    flowNodes,
    viewerVisible,
    viewerLoading,
    viewerError,
    viewerState,
    selectedNode,
    selectedRuntimeNode,
    selectedRuntimeStep,
    selectedNodeMessages,
    selectedNodeSessionMetadata,
    selectedNodeSessionId,
    runningPlaceholderViewModel,
    selectedGraphDialogProcessId,
    runtimeNodeSessions,
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
    selectedNodeSessionMetadata,
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
    selectedNodeSessionDocs,
    displayNodeMessages,
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
  };
}
