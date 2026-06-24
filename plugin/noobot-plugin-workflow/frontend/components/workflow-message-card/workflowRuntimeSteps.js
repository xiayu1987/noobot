/*
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
*/

import { resolveWorkflowDialogProcessId } from "./workflowDialogProcessIdCompat.js";

export function makeActionStateKey(item = {}, index = 0) {
  return String(
    item?.actionNodeStateId ||
      item?.nodeStateId ||
      item?.actionStateId ||
      item?.nodeBoxId ||
      item?.dialogProcessId ||
      item?.sessionId ||
      resolveWorkflowDialogProcessId(item) ||
      `node_box_${index + 1}`,
  ).trim();
}

export function makeRuntimeStep({ item = {}, index = 0, workflowPayload, nodeRunByDialogProcessId, resolveStepStatus }) {
  const dialogProcessId = resolveWorkflowDialogProcessId(item);
  const runItem = dialogProcessId ? nodeRunByDialogProcessId.value.get(dialogProcessId) : null;
  const stepId = String(item?.stepId || runItem?.stepId || dialogProcessId || item?.sessionId || `step_${index + 1}`).trim();
  const stepIndex = Number.isFinite(Number(item?.stepIndex ?? runItem?.stepIndex))
    ? Number(item?.stepIndex ?? runItem?.stepIndex)
    : index;
  const merged = {
    ...runItem,
    ...item,
    dialogProcessId,
    stepId,
    stepIndex,
    rootSessionId: String(
      item?.rootSessionId ||
        workflowPayload.value?.planningDialog?.sessionId ||
        workflowPayload.value?.runMeta?.sessionId ||
        "",
    ).trim(),
  };
  return {
    ...merged,
    _boxType: "step",
    _status: resolveStepStatus(merged),
  };
}

export function stripRuntimeInternal(runtime = {}) {
  return {
    nodeId: String(runtime?.nodeId || "").trim(),
    nodeName: String(runtime?.nodeName || "").trim(),
    actionNodeStates: Array.isArray(runtime?.actionNodeStates)
      ? runtime.actionNodeStates.map((stateBox = {}, stateIndex) => ({
          actionNodeStateId: String(stateBox?.actionNodeStateId || `node_box_${stateIndex + 1}`).trim(),
          nodeId: String(stateBox?.nodeId || runtime?.nodeId || "").trim(),
          nodeName: String(stateBox?.nodeName || runtime?.nodeName || "").trim(),
          steps: Array.isArray(stateBox?.steps) ? stateBox.steps : [],
        }))
      : [],
  };
}

export function firstRuntimeStep(actionNodeStates = []) {
  for (const stateBox of Array.isArray(actionNodeStates) ? actionNodeStates : []) {
    const stepItem = Array.isArray(stateBox?.steps) ? stateBox.steps[0] : null;
    if (stepItem) return stepItem;
  }
  return null;
}
