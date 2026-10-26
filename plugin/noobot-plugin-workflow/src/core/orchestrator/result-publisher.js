/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_TRACE } from "../constants.js";
import { appendWorkflowTrace } from "../hooks/phase.js";
import { publishWorkflowFinalMessage } from "../hooks/persistence.js";

export async function publishWorkflowResult({
  options,
  ctx,
  agentResult,
  semanticText,
  workflowPayload,
  nodeTransferEnvelopes,
  execution,
}) {
  await publishWorkflowFinalMessage({
    options,
    agentResult,
    ctx,
    semanticText,
    workflowPayload,
    nodeTransferEnvelopes,
  });
  appendWorkflowTrace(agentResult, {
    stage: WORKFLOW_TRACE.STAGE_EXECUTED,
    workflowRunId: workflowPayload.workflowRunId,
    completed: execution.completed,
    pendingStepCount: execution.pendingStepCount,
    autoTransitions: execution.autoTransitions,
  });
}
