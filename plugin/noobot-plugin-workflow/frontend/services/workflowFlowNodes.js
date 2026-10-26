/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed } from "vue";
import { WORKFLOW_NODE_TYPE } from "@noobot/event-protocol/workflow-runtime-event";
import { resolveActionRuntimeStatus } from "../runtime/workflowRuntimeStatus.js";
import { firstRuntimeStep } from "../runtime/workflowRuntimeSteps.js";

function buildStateFlowNode(nodeItem) {
  return {
    nodeId: nodeItem.id,
    nodeName: nodeItem.name,
    type: nodeItem.type,
    stateType: nodeItem.stateType,
    actionNodeStates: [],
  };
}

function buildActionFlowNode({ nodeItem, actionRuntimeByNodeId }) {
  const { actionNodeStates } = actionRuntimeByNodeId.value.get(nodeItem.id);
  return {
    ...firstRuntimeStep(actionNodeStates),
    nodeId: nodeItem.id,
    nodeName: nodeItem.name,
    type: nodeItem.type,
    actionNodeStates,
    status: resolveActionRuntimeStatus(actionNodeStates),
  };
}

export function createFlowNodes({ workflowPayload, actionRuntimeByNodeId }) {
  return computed(() => {
    const semanticNodes = Array.isArray(workflowPayload.value?.semantic?.nodes)
      ? workflowPayload.value.semantic.nodes
      : [];
    return semanticNodes.map((nodeItem) =>
      nodeItem.type === WORKFLOW_NODE_TYPE.ACTION
        ? buildActionFlowNode({ nodeItem, actionRuntimeByNodeId })
        : buildStateFlowNode(nodeItem),
    );
  });
}
