/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function createWorkflowNodeViewKey(nodeItem) {
  return `${nodeItem.rootSessionId}:${nodeItem.nodeExecutionId}`;
}

function runtimeSteps(runtimeNode) {
  return runtimeNode.actionNodeStates.flatMap((stateBox) => stateBox.steps);
}

export function findWorkflowOwningRuntimeNode(stepItem, flowNodes) {
  return (
    flowNodes.find((nodeItem) =>
      runtimeSteps(nodeItem).some(
        (candidate) => candidate.nodeExecutionId === stepItem.nodeExecutionId,
      ),
    ) || null
  );
}

export function findCurrentWorkflowRuntimeStep(stepItem, runtimeNode) {
  if (!stepItem || !runtimeNode) return null;
  return (
    runtimeSteps(runtimeNode).find(
      (candidate) => candidate.nodeExecutionId === stepItem.nodeExecutionId,
    ) || null
  );
}

export function findCurrentWorkflowRuntimeNode(nodeItem, flowNodes) {
  return flowNodes.find((candidate) => candidate.nodeId === nodeItem.nodeId) || null;
}
