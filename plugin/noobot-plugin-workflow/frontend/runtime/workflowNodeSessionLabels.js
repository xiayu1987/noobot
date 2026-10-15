/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { resolveWorkflowDialogProcessId } from "../utils/workflowDialogProcessId.js";
import { text } from "@noobot/shared/value";

export function useWorkflowNodeSessionLabels(translate) {
  function resolveStatusLabel(nodeItem = {}) {
    const status = text(nodeItem?._status || nodeItem?.status).toLowerCase();
    if (status === "success") return translate("workflow.statusSuccess");
    if (status === "failed" || status === "error") return translate("workflow.statusFailed");
    if (status === "running") return translate("workflow.statusRunning");
    return translate("workflow.statusPending");
  }

  function resolveStatusClass(nodeItem = {}) {
    const status = text(nodeItem?._status || nodeItem?.status).toLowerCase();
    if (status === "success") return "success";
    if (status === "failed" || status === "error") return "failed";
    if (status === "running") return "running";
    return "pending";
  }

  function resolveStepLabel(stepItem = {}, stepIndex = 0) {
    const order = Number.isFinite(Number(stepItem?.stepIndex))
      ? Number(stepItem.stepIndex) + 1
      : stepIndex + 1;
    return translate("workflow.stepBoxLabel", { order });
  }

  function resolveStateBoxLabel(stateBox = {}, stateIndex = 0) {
    const id = text(stateBox?.actionNodeStateId);
    if (!id) return translate("workflow.nodeBoxLabelFallback", { index: stateIndex + 1 });
    return translate("workflow.nodeBoxLabel", { id });
  }

  function stepHasSession(stepItem = {}) {
    return Boolean(
      text(stepItem?.activeChildExecutionId) ||
      (Array.isArray(stepItem?.attemptExecutionIds) &&
        stepItem.attemptExecutionIds.some(Boolean)) ||
      resolveWorkflowDialogProcessId(stepItem),
    );
  }

  return {
    resolveStatusLabel,
    resolveStatusClass,
    resolveStepLabel,
    resolveStateBoxLabel,
    stepHasSession,
  };
}
