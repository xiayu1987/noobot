/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed, ref, watch } from "vue";

function text(value) {
  return String(value || "").trim();
}

export function resolveWorkflowViewerKey(workflowPayload = {}) {
  return text(
    workflowPayload?.workflowRunId ||
      workflowPayload?.execution?.workflowRunId ||
      workflowPayload?.execution?.instanceId ||
      workflowPayload?.planningDialog?.workflowRunId ||
      workflowPayload?.runMeta?.workflowRunId,
  );
}

function registryValue(registry) {
  if (registry && typeof registry === "object" && "value" in registry) return registry.value;
  return registry;
}

export function useWorkflowViewerState(workflowPayload, workflowNodeStateRegistry = null) {
  const workflowRunId = computed(() => resolveWorkflowViewerKey(workflowPayload.value));
  const registry = registryValue(workflowNodeStateRegistry);
  const initialState = workflowRunId.value && registry?.viewerStates?.[workflowRunId.value]
    ? registry.viewerStates[workflowRunId.value]
    : {};

  const viewerVisible = ref(false);
  const selectedNode = ref(initialState.selectedNode || null);
  const selectedRuntimeNode = ref(initialState.selectedRuntimeNode || null);
  const selectedRuntimeStep = ref(initialState.selectedRuntimeStep || null);
  const selectedGraphDialogProcessId = ref(text(initialState.selectedGraphDialogProcessId));

  watch(
    [workflowRunId, viewerVisible, selectedNode, selectedRuntimeNode, selectedRuntimeStep, selectedGraphDialogProcessId],
    ([key, visible, node, runtimeNode, runtimeStep, dialogProcessId]) => {
      const target = registryValue(workflowNodeStateRegistry);
      if (!key || !target) return;
      target.viewerStates ||= {};
      target.viewerStates[key] = {
        viewerVisible: false,
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
