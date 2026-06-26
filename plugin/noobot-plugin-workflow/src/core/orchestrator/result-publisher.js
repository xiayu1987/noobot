/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_TRACE } from "../constants.js";
import { appendWorkflowTrace } from "../hooks/phase.js";
import { appendWorkflowPlanningMessage } from "../hooks/persistence.js";

export async function publishWorkflowResult({
  options = {},
  ctx = {},
  agentResult = {},
  sourceText = "",
  semanticText = "",
  semanticResolution = {},
  workflowPayload = {},
  workflowAttachments = [],
  execution = {},
  beforeDispatchMode = false,
} = {}) {
  agentResult.workflow = workflowPayload;
  await appendWorkflowPlanningMessage({
    options,
    agentResult,
    ctx,
    sourceText,
    semanticText,
    semanticResolution,
    workflowPayload,
    attachments: workflowAttachments,
  });
  appendWorkflowTrace(agentResult, {
    stage: WORKFLOW_TRACE.STAGE_EXECUTED,
    interactionId: workflowPayload.interactionId,
    protocolVersion: workflowPayload.protocolVersion,
    completed: execution?.completed === true,
    pendingStepCount: execution?.pendingStepCount ?? 0,
    autoTransitions: execution?.autoTransitions ?? 0,
  });
  if (beforeDispatchMode) {
    ctx.skipAgentDispatch = true;
    ctx.overrideAgentResult = agentResult;
  }
}
