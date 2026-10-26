/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed, ref, watch } from "vue";
import { text } from "@noobot/shared/value";

export function useWorkflowViewerState(workflowPayload, workflowNodeStateRegistry) {
  const workflowRunId = computed(() => text(workflowPayload.value?.workflowRunId));
  const initialState = workflowNodeStateRegistry.viewerStates[workflowRunId.value] || {};

  const viewerVisible = ref(false);
  const selectedNode = ref(initialState.selectedNode || null);
  const selectedRuntimeNode = ref(initialState.selectedRuntimeNode || null);
  const selectedRuntimeStep = ref(initialState.selectedRuntimeStep || null);
  const selectedGraphDialogProcessId = ref(text(initialState.selectedGraphDialogProcessId));

  watch(
    [
      workflowRunId,
      selectedNode,
      selectedRuntimeNode,
      selectedRuntimeStep,
      selectedGraphDialogProcessId,
    ],
    ([key, node, runtimeNode, runtimeStep, dialogProcessId]) => {
      if (!key) return;
      workflowNodeStateRegistry.viewerStates[key] = {
        selectedNode: node,
        selectedRuntimeNode: runtimeNode,
        selectedRuntimeStep: runtimeStep,
        selectedGraphDialogProcessId: dialogProcessId,
      };
    },
    { deep: true, flush: "sync" },
  );

  return {
    viewerVisible,
    selectedNode,
    selectedRuntimeNode,
    selectedRuntimeStep,
    selectedGraphDialogProcessId,
  };
}
