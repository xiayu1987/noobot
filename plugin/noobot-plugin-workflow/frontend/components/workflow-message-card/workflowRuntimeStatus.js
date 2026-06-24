/*
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
*/

export function normalizeStatus(value = "") {
  const status = String(value || "").trim().toLowerCase();
  if (status === "error") return "failed";
  if (status === "done" || status === "completed") return "success";
  return status;
}

import { resolveWorkflowDialogProcessId } from "./workflowDialogProcessIdCompat.js";

export function createStepStatusResolver({ nodeRunByDialogProcessId }) {
  return function resolveStepStatus(stepItem = {}) {
    const failure = stepItem?.stepFailure;
    if (failure && typeof failure === "object") {
      if (String(failure?.message || failure?.error || "").trim()) return "failed";
    } else if (String(failure || "").trim()) {
      return "failed";
    }

    const explicit = normalizeStatus(stepItem?.stepStatus || stepItem?.status || stepItem?._status || "");
    if (explicit) return explicit;

    const dialogProcessId = resolveWorkflowDialogProcessId(stepItem);
    const runItem = dialogProcessId ? nodeRunByDialogProcessId.value.get(dialogProcessId) : null;
    if (runItem?.stepFailure) return "failed";

    const runStatus = normalizeStatus(runItem?.stepStatus || runItem?.status || "");
    if (runStatus) return runStatus;
    if (String(stepItem?.sessionId || "").trim() || dialogProcessId) return "success";
    return "pending";
  };
}

export function resolveActionRuntimeStatus(actionNodeStates = [], resolveStepStatus) {
  const steps = [];
  for (const stateBox of Array.isArray(actionNodeStates) ? actionNodeStates : []) {
    for (const stepItem of Array.isArray(stateBox?.steps) ? stateBox.steps : []) steps.push(stepItem);
  }
  if (!steps.length) return "pending";

  const statuses = steps.map((stepItem) => resolveStepStatus(stepItem));
  if (statuses.some((status) => status === "running")) return "running";
  if (statuses.some((status) => status === "failed" || status === "error")) return "failed";
  if (statuses.every((status) => status === "success")) return "success";
  if (statuses.some((status) => status === "success")) return "success";
  return "pending";
}
