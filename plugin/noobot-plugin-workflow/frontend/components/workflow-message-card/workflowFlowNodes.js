/*
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
*/
import { computed } from "vue";
import { resolveActionRuntimeStatus } from "./workflowRuntimeStatus.js";
import { firstRuntimeStep, stripRuntimeInternal } from "./workflowRuntimeSteps.js";

function buildFlowNodeFromRuntime({ runtime = {}, index = 0, semanticNodeMap, resolveStepStatus }) {
  const cleanRuntime = stripRuntimeInternal(runtime);
  const firstStep = firstRuntimeStep(cleanRuntime.actionNodeStates) || {};
  const semanticNode =
    semanticNodeMap.value.get(`id:${cleanRuntime.nodeId}`) ||
    semanticNodeMap.value.get(`name:${cleanRuntime.nodeName}`) ||
    null;
  return {
    ...firstStep,
    nodeId: cleanRuntime.nodeId || String(firstStep?.nodeId || "").trim(),
    nodeName: cleanRuntime.nodeName || String(firstStep?.nodeName || firstStep?.nodeId || "").trim(),
    nodeType: 2,
    type: String(firstStep?.type || semanticNode?.type || "action").trim(),
    stateType: Number.isFinite(Number(firstStep?.stateType))
      ? Number(firstStep.stateType)
      : Number.isFinite(Number(semanticNode?.stateType))
        ? Number(semanticNode.stateType)
        : undefined,
    actionNodeStates: cleanRuntime.actionNodeStates,
    runtimeBoxes: cleanRuntime.actionNodeStates,
    status: resolveActionRuntimeStatus(cleanRuntime.actionNodeStates, resolveStepStatus),
    _order: Number.isFinite(Number(firstStep?.transition)) ? Number(firstStep.transition) : index + 1,
  };
}

function buildFlowNodeFromSemantic({ nodeItem = {}, index = 0, workflowPayload, executionMeta, actionRuntimeBySemanticKey, resolveStepStatus }) {
  const nodeId = String(nodeItem?.id || "").trim();
  const nodeName = String(nodeItem?.name || nodeId || "").trim();
  const matchedRuntime =
    actionRuntimeBySemanticKey.value.get(`id:${nodeId}`) ||
    actionRuntimeBySemanticKey.value.get(`name:${nodeName}`) ||
    null;
  const cleanRuntime = matchedRuntime ? stripRuntimeInternal(matchedRuntime) : { actionNodeStates: [] };
  const firstStep = firstRuntimeStep(cleanRuntime.actionNodeStates) || {};
  const completed = executionMeta.value?.completed === true;
  const nodeType = String(nodeItem?.type || "").trim().toLowerCase();
  const isAction = nodeType === "action";
  const runtimeStatus = resolveActionRuntimeStatus(cleanRuntime.actionNodeStates, resolveStepStatus);
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
    type: String(nodeItem?.type || "").trim(),
    stateType: Number.isFinite(Number(nodeItem?.stateType))
      ? Number(nodeItem.stateType)
      : undefined,
    rootSessionId: String(
      firstStep?.rootSessionId ||
        workflowPayload.value?.planningDialog?.sessionId ||
        workflowPayload.value?.runMeta?.sessionId ||
        "",
    ).trim(),
    actionNodeStates: isAction ? cleanRuntime.actionNodeStates : [],
    runtimeBoxes: isAction ? cleanRuntime.actionNodeStates : [],
    status: restoredStatus,
    _order: Number.isFinite(Number(firstStep?.transition))
      ? Number(firstStep.transition)
      : index + 1,
  };
}

export function createFlowNodes({ workflowPayload, executionMeta, semanticNodeMap, actionRuntimeBySemanticKey, resolveStepStatus }) {
  return computed(() => {
    const semanticNodes = Array.isArray(workflowPayload.value?.semantic?.nodes)
      ? workflowPayload.value.semantic.nodes
      : [];
    if (semanticNodes.length) {
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
    }
    const uniqueRuntimes = Array.from(new Set(actionRuntimeBySemanticKey.value.values()));
    return uniqueRuntimes
      .map((runtime, index) =>
        buildFlowNodeFromRuntime({ runtime, index, semanticNodeMap, resolveStepStatus }),
      )
      .sort((left, right) => Number(left?._order || 0) - Number(right?._order || 0));
  });
}
