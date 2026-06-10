/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  WORKFLOW_PHASE_STATUS,
  WORKFLOW_PHASES,
  WORKFLOW_TRACE,
} from "../constants.js";
import { appendWorkflowTrace } from "../hooks/phase.js";
import { emitWorkflowRuntimeEvent } from "../hooks/persistence.js";
import { buildWorkflowOrchestrationPayload } from "../orchestration-payload.js";

function resolveWorkflowErrorMessage(error = null) {
  return String(error?.message || error || "");
}

export async function handleWorkflowFailure({
  error,
  options = {},
  ctx = {},
  agentResult = {},
  sourceText = "",
  phaseTracker,
  retryMeta = {},
  beforeDispatchMode = false,
} = {}) {
  const message = resolveWorkflowErrorMessage(error);
  retryMeta.history.push({
    attempt: 1,
    status: WORKFLOW_PHASE_STATUS.FAILED,
    timestamp: new Date().toISOString(),
    message,
  });
  phaseTracker.end(WORKFLOW_PHASES.SEMANTIC_RESOLUTION, WORKFLOW_PHASE_STATUS.FAILED, {
    message,
  });
  phaseTracker.end(WORKFLOW_PHASES.WORKFLOW_EXECUTION, WORKFLOW_PHASE_STATUS.FAILED, {
    message,
  });
  await emitWorkflowRuntimeEvent({
    options,
    ctx,
    event: "workflow_execution_failed",
    level: "error",
    data: { message },
  });
  const workflowPayload = buildWorkflowOrchestrationPayload({
    ctx,
    options,
    sourceText,
    semanticText: sourceText,
    semantic: null,
    execution: null,
    semanticResolution: { invoked: typeof options?.capabilityModelInvoker === "function" },
    phaseTimeline: phaseTracker.list(),
    retryMeta,
    error,
  });
  agentResult.workflow = workflowPayload;
  appendWorkflowTrace(agentResult, {
    stage: WORKFLOW_TRACE.STAGE_FAILED,
    interactionId: workflowPayload.interactionId,
    protocolVersion: workflowPayload.protocolVersion,
    message,
  });
  if (!beforeDispatchMode) return;

  ctx.skipAgentDispatch = false;
  ctx.overrideAgentResult = null;
  ctx.workflowFallbackToMainAgent = true;
  await emitWorkflowRuntimeEvent({
    options,
    ctx,
    event: "workflow_fallback_to_main_agent",
    level: "warn",
    data: {
      reason: "workflow_execution_failed",
      message,
    },
  });
}
