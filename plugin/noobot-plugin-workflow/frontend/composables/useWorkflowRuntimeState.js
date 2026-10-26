/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed } from "vue";
import { createActionRuntimeByNodeId } from "../runtime/workflowActionRuntimeMap.js";
import { createFlowNodes } from "../services/workflowFlowNodes.js";
import { createRuntimeNodeSessions } from "../runtime/workflowRuntimeSessions.js";

export function useWorkflowRuntimeState(workflowPayload, runtimeRegistries = {}) {
  const nodeSessions = computed(() => {
    const fromPayload = Array.isArray(workflowPayload.value?.nodeSessions)
      ? workflowPayload.value.nodeSessions
      : [];
    return fromPayload;
  });

  const runtimeNodeSessions = createRuntimeNodeSessions({
    workflowPayload,
    nodeSessions,
    workflowNodeStateRegistry: runtimeRegistries.workflowNodeStateRegistry,
  });

  const actionRuntimeByNodeId = createActionRuntimeByNodeId({
    runtimeNodeSessions,
    workflowPayload,
  });

  const flowNodes = createFlowNodes({
    workflowPayload,
    actionRuntimeByNodeId,
  });

  return {
    nodeSessions,
    runtimeNodeSessions,
    flowNodes,
  };
}
