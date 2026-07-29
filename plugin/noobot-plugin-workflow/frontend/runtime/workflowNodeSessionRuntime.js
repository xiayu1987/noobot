/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveWorkflowDialogProcessId } from "../utils/workflowDialogProcessIdCompat.js";
const text = (value) => String(value || "").trim();

export function resolveWorkflowDetailSessionId(detail = {}) {
  return text(detail?.sessionId || detail?.sessionSummary?.sessionId || detail?.session?.sessionId || detail?.session?.id);
}

export function createWorkflowNodeViewKey(nodeItem = {}, workflowPayload = {}) {
  const rootSessionId = text(
    nodeItem?.rootSessionId || workflowPayload?.planningDialog?.sessionId || workflowPayload?.runMeta?.sessionId,
  );
  const identity = [
    text(nodeItem?.nodeExecutionId),
    text(nodeItem?.activeChildExecutionId || nodeItem?.childExecutionId),
    text(nodeItem?.turnScopeId),
    resolveWorkflowDialogProcessId(nodeItem),
    text(nodeItem?.nodeSessionId || nodeItem?.sessionId),
    text(nodeItem?.stepId),
  ].find(Boolean);
  return rootSessionId && identity ? `${rootSessionId}:${identity}` : identity;
}

export function findWorkflowOwningRuntimeNode(stepItem = {}, flowNodes = []) {
  const stepExecutionId = text(stepItem?.nodeExecutionId);
  const stepDialogProcessId = resolveWorkflowDialogProcessId(stepItem);
  const stepSessionId = text(stepItem?.sessionId || stepItem?.nodeSessionId);
  return (Array.isArray(flowNodes) ? flowNodes : []).find((nodeItem = {}) =>
    (Array.isArray(nodeItem?.actionNodeStates) ? nodeItem.actionNodeStates : []).some((stateBox = {}) =>
      (Array.isArray(stateBox?.steps) ? stateBox.steps : []).some((candidate = {}) => {
        if (stepExecutionId && text(candidate?.nodeExecutionId) === stepExecutionId) return true;
        if (stepDialogProcessId && resolveWorkflowDialogProcessId(candidate) === stepDialogProcessId) return true;
        return Boolean(stepSessionId && text(candidate?.sessionId || candidate?.nodeSessionId) === stepSessionId);
      }),
    ),
  ) || null;
}

export function findCurrentWorkflowRuntimeStep(stepItem = {}, runtimeNode = null) {
  if (!stepItem || !runtimeNode) return null;
  const stepExecutionId = text(stepItem?.nodeExecutionId);
  const stepDialogProcessId = resolveWorkflowDialogProcessId(stepItem);
  const stepSessionId = text(stepItem?.sessionId || stepItem?.nodeSessionId);
  const stepId = text(stepItem?.stepId);
  const candidates = (Array.isArray(runtimeNode?.actionNodeStates) ? runtimeNode.actionNodeStates : [])
    .flatMap((stateBox = {}) => Array.isArray(stateBox?.steps) ? stateBox.steps : []);
  return candidates.find((candidate = {}) => {
    if (stepExecutionId && text(candidate?.nodeExecutionId) === stepExecutionId) return true;
    if (stepDialogProcessId && resolveWorkflowDialogProcessId(candidate) === stepDialogProcessId) return true;
    if (stepSessionId && text(candidate?.sessionId || candidate?.nodeSessionId) === stepSessionId) return true;
    return Boolean(stepId && text(candidate?.stepId) === stepId);
  }) || null;
}

export function findCurrentWorkflowRuntimeNode(nodeItem = {}, flowNodes = []) {
  const nodeId = text(nodeItem?.nodeId);
  const nodeExecutionId = text(nodeItem?.nodeExecutionId);
  const dialogProcessId = resolveWorkflowDialogProcessId(nodeItem);
  return (Array.isArray(flowNodes) ? flowNodes : []).find((candidate = {}) => {
    if (nodeExecutionId && text(candidate?.nodeExecutionId) === nodeExecutionId) return true;
    if (dialogProcessId && resolveWorkflowDialogProcessId(candidate) === dialogProcessId) return true;
    return Boolean(nodeId && text(candidate?.nodeId) === nodeId);
  }) || null;
}
