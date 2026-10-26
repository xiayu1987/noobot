/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { onMounted, watch } from "vue";
import { useOverlayHistory } from "noobot-chat/plugin-api/ui";
import { isSameWorkflowDrawerRoute } from "./workflowNodeSessionIdentity.js";
import { createWorkflowNodeDetailTraceId } from "./workflowNodeSessionDiagnostics.js";
import {
  readWorkflowDrawerQuery,
  writeWorkflowDrawerQuery,
} from "../services/workflowDrawerHistory.js";
import { text } from "@noobot/shared/value";

export function useWorkflowNodeSessionHistory({
  props,
  flowNodes,
  viewerVisible,
  selectedNode,
  selectedRuntimeNode,
  selectedRuntimeStep,
  nodeViewTransaction,
  buildWorkflowDrawerRoute,
  findWorkflowSessionTarget,
  openNodeSession,
}) {
  useOverlayHistory(viewerVisible, () => {
    viewerVisible.value = false;
  });

  watch(
    () =>
      viewerVisible.value && selectedNode.value
        ? buildWorkflowDrawerRoute(selectedNode.value)
        : null,
    (route) => writeWorkflowDrawerQuery(route || {}),
    { flush: "sync" },
  );

  watch(
    () => viewerVisible.value,
    (visible) => {
      if (visible) return;
      selectedRuntimeNode.value = null;
      selectedRuntimeStep.value = null;
      nodeViewTransaction.invalidate();
    },
    { flush: "sync" },
  );

  onMounted(() => {
    const initialRoute = readWorkflowDrawerQuery();
    if (!initialRoute.dialogProcessId || !initialRoute.rootSessionId) return;
    const selectedRoute = selectedNode.value ? buildWorkflowDrawerRoute(selectedNode.value) : null;
    if (selectedRoute && isSameWorkflowDrawerRoute(initialRoute, selectedRoute)) {
      props.logWorkflowDiagnostics("frontend.workflowNodeDetail.initialRouteConsumed", {
        sessionId: text(initialRoute.rootSessionId),
        dialogProcessId: text(initialRoute.dialogProcessId),
        turnScopeId: text(selectedNode.value?.turnScopeId),
        workflowRunId: text(selectedNode.value?.workflowRunId),
        nodeExecutionId: text(selectedNode.value?.nodeExecutionId),
        reason: "existing_viewer_selection",
      });
      writeWorkflowDrawerQuery({});
      return;
    }
    const target = findWorkflowSessionTarget(initialRoute);
    writeWorkflowDrawerQuery({});
    if (!target) return;
    selectedRuntimeNode.value =
      flowNodes.value.find((nodeItem) =>
        nodeItem.actionNodeStates.some((stateBox) => stateBox.steps.includes(target)),
      ) || selectedRuntimeNode.value;
    openNodeSession(target, { traceId: createWorkflowNodeDetailTraceId() });
  });
}
