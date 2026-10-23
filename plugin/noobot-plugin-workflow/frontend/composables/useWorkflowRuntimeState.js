/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed } from "vue";
import { isPlainObject } from "@noobot/shared/value";
import { createActionRuntimeBySemanticKey } from "../runtime/workflowActionRuntimeMap.js";
import { createFlowNodes } from "../services/workflowFlowNodes.js";
import { createRuntimeNodeSessions } from "../runtime/workflowRuntimeSessions.js";
import { createStepStatusResolver } from "../runtime/workflowRuntimeStatus.js";

export function useWorkflowRuntimeState(workflowPayload, runtimeRegistries = {}) {
  const nodeSessions = computed(() => {
    const fromPayload = Array.isArray(workflowPayload.value?.nodeSessions)
      ? workflowPayload.value.nodeSessions
      : [];
    return fromPayload;
  });

  const executionMeta = computed(() =>
    isPlainObject(workflowPayload.value?.execution) ? workflowPayload.value.execution : {},
  );

  const runtimeNodeSessions = createRuntimeNodeSessions({
    workflowPayload,
    nodeSessions,
    workflowNodeStateRegistry: runtimeRegistries.workflowNodeStateRegistry,
  });

  const resolveStepStatus = createStepStatusResolver();

  const actionRuntimeBySemanticKey = createActionRuntimeBySemanticKey({
    runtimeNodeSessions,
    workflowPayload,
    resolveStepStatus,
  });

  const flowNodes = createFlowNodes({
    workflowPayload,
    executionMeta,
    actionRuntimeBySemanticKey,
    resolveStepStatus,
  });

  return {
    nodeSessions,
    runtimeNodeSessions,
    flowNodes,
  };
}
