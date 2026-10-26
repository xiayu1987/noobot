/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { resolveWorkflowDialogProcessId } from "../utils/workflowDialogProcessId.js";
import {
  resolveWorkflowNodeStatus,
  resolveWorkflowNodeStatusLabelKey,
} from "./workflowRuntimeStatus.js";
import { text } from "@noobot/shared/value";

export function useWorkflowNodeSessionLabels(translate) {
  function resolveStatusLabel(nodeItem = {}) {
    return translate(resolveWorkflowNodeStatusLabelKey(nodeItem));
  }

  function resolveStatusClass(nodeItem = {}) {
    return resolveWorkflowNodeStatus(nodeItem);
  }

  function resolveStepLabel(stepIndex) {
    return translate("workflow.stepBoxLabel", { order: stepIndex + 1 });
  }

  function resolveStateBoxLabel(stateBox) {
    return translate("workflow.nodeBoxLabel", { id: stateBox.nodeExecutionId });
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
