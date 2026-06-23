/*
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
*/
import { ref } from "vue";
import { useWorkflowMeta } from "./useWorkflowMeta";
import { useWorkflowRuntimeState } from "./useWorkflowRuntimeState";
import { useWorkflowNodeMessages } from "./useWorkflowNodeMessages";
import { useWorkflowNodeSessionViewer } from "./useWorkflowNodeSessionViewer";

export function useWorkflowMessageCardState(props, emit, translate) {
  const viewerVisible = ref(false);
  const viewerLoading = ref(false);
  const viewerError = ref("");
  const selectedNode = ref(null);
  const selectedRuntimeNode = ref(null);
  const selectedRuntimeStep = ref(null);
  const selectedNodeMessages = ref([]);
  const selectedNodeRawMessages = ref([]);
  const selectedNodeSessionSummary = ref(null);
  const selectedNodeSessionId = ref("");
  const selectedGraphDialogId = ref("");
  const semanticPreviewExpanded = ref(false);
  const applyingWorkflowDrawerHistory = ref(false);

  const {
    workflowMeta,
    workflowPayload,
    semanticFlowtos,
    semanticPreview,
    semanticPreviewLineCount,
    semanticPreviewCollapsible,
  } = useWorkflowMeta(props);

  const {
    nodeSessions,
    runtimeNodeSessions,
    flowNodes,
  } = useWorkflowRuntimeState(workflowPayload);

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
    handleSelectedDialogUpdate,
  } = useWorkflowNodeSessionViewer({
    props,
    emit,
    translate,
    workflowPayload,
    flowNodes,
    viewerVisible,
    viewerLoading,
    viewerError,
    selectedNode,
    selectedRuntimeNode,
    selectedRuntimeStep,
    selectedNodeMessages,
    selectedNodeRawMessages,
    selectedNodeSessionSummary,
    selectedNodeSessionId,
    selectedGraphDialogId,
    applyingWorkflowDrawerHistory,
  });

  return {
    viewerVisible,
    viewerLoading,
    viewerError,
    selectedNode,
    selectedRuntimeNode,
    selectedRuntimeStep,
    selectedNodeMessages,
    selectedNodeRawMessages,
    selectedNodeSessionSummary,
    selectedNodeSessionId,
    selectedGraphDialogId,
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
    handleSelectedDialogUpdate,
  };
}
