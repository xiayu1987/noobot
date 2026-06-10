/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_PHASE_STATUS, WORKFLOW_PHASES } from "../constants.js";
import { throwIfWorkflowAborted } from "../hooks/runtime.js";
import { emitWorkflowRuntimeEvent } from "../hooks/persistence.js";
import { endWorkflowPhase } from "./phase-events.js";
import { runWorkflowExecution } from "./execution-runner.js";

export async function runWorkflowExecutionStage({
  hookManager,
  options = {},
  ctx = {},
  semantic = {},
  phaseTracker,
} = {}) {
  phaseTracker.start(WORKFLOW_PHASES.WORKFLOW_EXECUTION);
  throwIfWorkflowAborted(ctx);
  await emitWorkflowRuntimeEvent({
    options,
    ctx,
    event: "workflow_execution_started",
  });

  const { execution, nodeAgentRuns, instanceId } = await runWorkflowExecution({
    hookManager,
    options,
    ctx,
    semantic,
  });
  const executionMeta = {
    completed: execution.completed,
    pendingStepCount: execution.pendingStepCount,
    instanceId,
  };
  await endWorkflowPhase({
    phaseTracker,
    phase: WORKFLOW_PHASES.WORKFLOW_EXECUTION,
    status: WORKFLOW_PHASE_STATUS.SUCCEEDED,
    meta: executionMeta,
    options,
    ctx,
    event: "workflow_execution_succeeded",
    data: {
      ...executionMeta,
      autoTransitions: execution.autoTransitions,
    },
  });

  return {
    execution,
    nodeAgentRuns,
    instanceId,
  };
}
