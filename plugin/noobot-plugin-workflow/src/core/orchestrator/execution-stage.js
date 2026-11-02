/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { throwIfWorkflowAborted } from "../hooks/runtime.js";
import { runWorkflowExecution } from "./execution-runner.js";

export async function runWorkflowExecutionStage({
  hookManager,
  options,
  ctx,
  signal,
  semantic,
  workflowRunId,
  initialNodeStateSnapshot,
}) {
  throwIfWorkflowAborted(signal);
  const { execution, nodeAgentRuns, nodeStateSnapshot } = await runWorkflowExecution({
    hookManager,
    options,
    ctx,
    signal,
    semantic,
    workflowRunId,
    nodeStateSnapshot: initialNodeStateSnapshot,
  });

  return {
    execution,
    nodeAgentRuns,
    nodeStateSnapshot,
  };
}
