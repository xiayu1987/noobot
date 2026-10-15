/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed } from "vue";
import { resolveActionRuntimeStatus } from "../runtime/workflowRuntimeStatus.js";
import { firstRuntimeStep, stripRuntimeInternal } from "../runtime/workflowRuntimeSteps.js";
import { text } from "@noobot/shared/value";

function buildFlowNodeFromSemantic({
  nodeItem = {},
  index = 0,
  workflowPayload,
  executionMeta,
  actionRuntimeBySemanticKey,
  resolveStepStatus,
}) {
  const nodeId = text(nodeItem?.id);
  const nodeName = text(nodeItem?.name || nodeId);
  const matchedRuntime =
    actionRuntimeBySemanticKey.value.get(`id:${nodeId}`) ||
    actionRuntimeBySemanticKey.value.get(`name:${nodeName}`) ||
    null;
  const cleanRuntime = matchedRuntime
    ? stripRuntimeInternal(matchedRuntime)
    : { actionNodeStates: [] };
  const firstStep = firstRuntimeStep(cleanRuntime.actionNodeStates) || {};
  const completed = executionMeta.value?.completed === true;
  const nodeType = text(nodeItem?.type).toLowerCase();
  const isAction = nodeType === "action";
  const runtimeStatus = resolveActionRuntimeStatus(
    cleanRuntime.actionNodeStates,
    resolveStepStatus,
  );
  const restoredStatus = isAction
    ? runtimeStatus !== "pending"
      ? runtimeStatus
      : completed
        ? "success"
        : "pending"
    : completed
      ? "success"
      : "pending";
  return {
    ...firstStep,
    nodeId,
    nodeName,
    nodeType: isAction ? 2 : 0,
    type: text(nodeItem?.type),
    stateType: Number.isFinite(Number(nodeItem?.stateType))
      ? Number(nodeItem.stateType)
      : undefined,
    rootSessionId: text(
      firstStep?.rootSessionId ||
        workflowPayload.value?.planningDialog?.sessionId ||
        workflowPayload.value?.runMeta?.sessionId,
    ),
    actionNodeStates: isAction ? cleanRuntime.actionNodeStates : [],
    runtimeBoxes: isAction ? cleanRuntime.actionNodeStates : [],
    status: restoredStatus,
    _order: Number.isFinite(Number(firstStep?.transition))
      ? Number(firstStep.transition)
      : index + 1,
  };
}

export function createFlowNodes({
  workflowPayload,
  executionMeta,
  actionRuntimeBySemanticKey,
  resolveStepStatus,
}) {
  return computed(() => {
    const semanticNodes = Array.isArray(workflowPayload.value?.semantic?.nodes)
      ? workflowPayload.value.semantic.nodes
      : [];
    return semanticNodes
      .map((item, index) =>
        buildFlowNodeFromSemantic({
          nodeItem: item,
          index,
          workflowPayload,
          executionMeta,
          actionRuntimeBySemanticKey,
          resolveStepStatus,
        }),
      )
      .sort((left, right) => Number(left?._order || 0) - Number(right?._order || 0));
  });
}
