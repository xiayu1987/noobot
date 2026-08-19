/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { watch } from "vue";
import {
  findCurrentWorkflowRuntimeNode,
  findCurrentWorkflowRuntimeStep,
} from "../../runtime/workflowNodeSessionRuntime.js";
import { resolveWorkflowDialogProcessId } from "../../utils/workflowDialogProcessId.js";

const text = (value) => String(value || "").trim();

function runtimeIdentity(item = {}) {
  return {
    dialogProcessId: resolveWorkflowDialogProcessId(item),
    turnScopeId: text(item.turnScopeId),
    workflowRunId: text(item.workflowRunId),
    nodeExecutionId: text(item.nodeExecutionId),
  };
}

export function watchRuntimeNodeRebound({ props, flowNodes, refs }) {
  return watch(
    () => flowNodes?.value,
    () => {
      const previous = refs.selectedRuntimeNode.value;
      if (!previous) return;
      const current = findCurrentWorkflowRuntimeNode(previous, flowNodes?.value);
      if (!current || current === previous) return;
      refs.selectedRuntimeNode.value = current;
      props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.runtimeNodeRebound", {
        ...runtimeIdentity(current),
        sessionId: text(
          refs.selectedNodeSessionId.value ||
            current.sessionId ||
            current.nodeSessionId ||
            previous.sessionId ||
            previous.nodeSessionId,
        ),
        nodeId: text(current.nodeId),
        boxCount: Array.isArray(current.actionNodeStates) ? current.actionNodeStates.length : 0,
        reason: "runtime_projection_updated",
      });
      const previousStep = refs.selectedRuntimeStep.value;
      const currentStep = findCurrentWorkflowRuntimeStep(previousStep, current);
      if (!previousStep || !currentStep || currentStep === previousStep) return;
      refs.selectedRuntimeStep.value = currentStep;
      refs.selectedNode.value = currentStep;
      props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.runtimeStepRebound", {
        ...runtimeIdentity(currentStep),
        sessionId: text(currentStep.sessionId || currentStep.nodeSessionId),
        stepId: text(currentStep.stepId),
        previousStatus: text(previousStep.status || previousStep.state),
        currentStatus: text(currentStep.status || currentStep.state),
        reason: "runtime_projection_updated",
      });
    },
    { flush: "sync" },
  );
}
