/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { onBeforeUnmount, onMounted, watch } from "vue";
import { workflowSessionText as text } from "./workflowNodeSessionProjection.js";
import { isSameWorkflowDrawerRoute } from "./workflowNodeSessionIdentity.js";

export function useWorkflowNodeSessionHistory({
  props,
  flowNodes,
  viewerVisible,
  selectedNode,
  selectedRuntimeNode,
  selectedRuntimeStep,
  applyingWorkflowDrawerHistory,
  nodeViewTransaction,
  buildWorkflowDrawerRoute,
  replaceWorkflowDrawerHistory,
  parseWorkflowDrawerRoute,
  findWorkflowSessionTarget,
  openNodeSession,
}) {
  async function applyWorkflowDrawerRoute(route = {}) {
    const target = findWorkflowSessionTarget(route);
    applyingWorkflowDrawerHistory.value = true;
    try {
      if (target) {
        selectedRuntimeNode.value = flowNodes.value.find((nodeItem = {}) =>
          (Array.isArray(nodeItem?.actionNodeStates) ? nodeItem.actionNodeStates : []).some((stateBox = {}) =>
            (Array.isArray(stateBox?.steps) ? stateBox.steps : []).includes(target),
          ),
        ) || selectedRuntimeNode.value;
        await openNodeSession(target, { fromHistory: true });
        return;
      }
      viewerVisible.value = false;
    } finally {
      applyingWorkflowDrawerHistory.value = false;
    }
  }

  async function handleWorkflowDrawerPopState(event) {
    await applyWorkflowDrawerRoute(parseWorkflowDrawerRoute(event?.state));
  }

  onMounted(() => {
    window.addEventListener("popstate", handleWorkflowDrawerPopState);
    const initialRoute = parseWorkflowDrawerRoute(history.state);
    if (!initialRoute.dialogProcessId || !initialRoute.rootSessionId) return;
    const selectedRoute = selectedNode.value
      ? buildWorkflowDrawerRoute(selectedNode.value)
      : null;
    if (selectedRoute && isSameWorkflowDrawerRoute(initialRoute, selectedRoute)) {
      props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.initialRouteConsumed", {
        sessionId: text(initialRoute.rootSessionId),
        dialogProcessId: text(initialRoute.dialogProcessId),
        turnScopeId: text(selectedNode.value?.turnScopeId),
        workflowRunId: text(selectedNode.value?.workflowRunId),
        nodeExecutionId: text(selectedNode.value?.nodeExecutionId),
        reason: "existing_viewer_selection",
      });
      replaceWorkflowDrawerHistory({ dialogProcessId: "", rootSessionId: "" });
      return;
    }
    applyWorkflowDrawerRoute(initialRoute);
  });

  onBeforeUnmount(() => {
    window.removeEventListener("popstate", handleWorkflowDrawerPopState);
  });

  watch(
    () => viewerVisible.value,
    (visible) => {
      if (visible || applyingWorkflowDrawerHistory.value) return;
      selectedRuntimeNode.value = null;
      selectedRuntimeStep.value = null;
      nodeViewTransaction.invalidate();
      replaceWorkflowDrawerHistory({ dialogProcessId: "", rootSessionId: "" });
    },
    { flush: "sync" },
  );
}
