/*
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
*/
import { computed } from "vue";
import { createActionRuntimeBySemanticKey } from "./workflowActionRuntimeMap.js";
import { createFlowNodes } from "./workflowFlowNodes.js";
import { createRuntimeNodeSessions } from "./workflowRuntimeSessions.js";
import { createStepStatusResolver } from "./workflowRuntimeStatus.js";
import { collectWorkflowDialogProcessIds } from "./workflowDialogProcessIdCompat.js";

export function useWorkflowRuntimeState(workflowPayload) {
  const nodeSessions = computed(() => {
    const fromPayload = Array.isArray(workflowPayload.value?.nodeSessions)
      ? workflowPayload.value.nodeSessions
      : [];
    return fromPayload;
  });

  const executionMeta = computed(() =>
    workflowPayload.value?.execution &&
    typeof workflowPayload.value.execution === "object" &&
    !Array.isArray(workflowPayload.value.execution)
      ? workflowPayload.value.execution
      : {},
  );

  const runtimeNodeSessions = createRuntimeNodeSessions({
    workflowPayload,
    nodeSessions,
    executionMeta,
  });

  const semanticNodeMap = computed(() => {
    const map = new Map();
    const nodes = Array.isArray(workflowPayload.value?.semantic?.nodes)
      ? workflowPayload.value.semantic.nodes
      : [];
    for (const nodeItem of nodes) {
      const id = String(nodeItem?.id || "").trim();
      const name = String(nodeItem?.name || "").trim();
      if (id) map.set(`id:${id}`, nodeItem);
      if (name) map.set(`name:${name}`, nodeItem);
    }
    return map;
  });

  const nodeRunByDialogProcessId = computed(() => {
    const map = new Map();
    const runs = Array.isArray(executionMeta.value?.nodeAgentRuns)
      ? executionMeta.value.nodeAgentRuns
      : [];
    for (const runItem of runs) {
      const dialogProcessIds = collectWorkflowDialogProcessIds(runItem);
      for (const dialogProcessId of dialogProcessIds) map.set(dialogProcessId, runItem);
    }
    return map;
  });

  const resolveStepStatus = createStepStatusResolver({ nodeRunByDialogProcessId });

  const actionRuntimeBySemanticKey = createActionRuntimeBySemanticKey({
    runtimeNodeSessions,
    workflowPayload,
    nodeRunByDialogProcessId,
    resolveStepStatus,
  });

  const flowNodes = createFlowNodes({
    workflowPayload,
    executionMeta,
    semanticNodeMap,
    actionRuntimeBySemanticKey,
    resolveStepStatus,
  });

  return {
    nodeSessions,
    runtimeNodeSessions,
    flowNodes,
  };
}
