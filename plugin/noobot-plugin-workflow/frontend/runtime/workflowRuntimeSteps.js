/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { resolveWorkflowDialogProcessId } from "../utils/workflowDialogProcessId.js";
import { text } from "@noobot/shared/value";

export function makeActionStateKey(item = {}, index = 0) {
  return String(
    item?.actionNodeStateId ||
      item?.dialogProcessId ||
      item?.sessionId ||
      resolveWorkflowDialogProcessId(item) ||
      `node_box_${index + 1}`,
  ).trim();
}

export function makeRuntimeStep({
  item = {},
  index = 0,
  workflowPayload,
  nodeRunByDialogProcessId,
  resolveStepStatus,
}) {
  const dialogProcessId = resolveWorkflowDialogProcessId(item);
  const runItem = dialogProcessId ? nodeRunByDialogProcessId.value.get(dialogProcessId) : null;
  const stepId = String(
    item?.stepId || runItem?.stepId || dialogProcessId || item?.sessionId || `step_${index + 1}`,
  ).trim();
  const stepIndex = Number.isFinite(Number(item?.stepIndex ?? runItem?.stepIndex))
    ? Number(item?.stepIndex ?? runItem?.stepIndex)
    : index;
  const merged = {
    ...runItem,
    ...item,
    dialogProcessId,
    stepId,
    stepIndex,
    rootSessionId: text(
      item?.rootSessionId ||
        workflowPayload.value?.planningDialog?.sessionId ||
        workflowPayload.value?.runMeta?.sessionId,
    ),
  };
  return {
    ...merged,
    _boxType: "step",
    _status: resolveStepStatus(merged),
  };
}

export function stripRuntimeInternal(runtime = {}) {
  return {
    nodeId: text(runtime?.nodeId),
    nodeName: text(runtime?.nodeName),
    actionNodeStates: Array.isArray(runtime?.actionNodeStates)
      ? runtime.actionNodeStates.map((stateBox = {}, stateIndex) => ({
          actionNodeStateId: String(
            stateBox?.actionNodeStateId || `node_box_${stateIndex + 1}`,
          ).trim(),
          nodeId: text(stateBox?.nodeId || runtime?.nodeId),
          nodeName: text(stateBox?.nodeName || runtime?.nodeName),
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
