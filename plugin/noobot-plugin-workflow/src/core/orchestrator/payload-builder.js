/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_PHASE_STATUS, WORKFLOW_PHASES } from "../constants.js";
import { throwIfWorkflowAborted } from "../hooks/runtime.js";
import { buildWorkflowOrchestrationPayload } from "../orchestration-payload.js";
import { enrichWorkflowPayload } from "./payload-enrichment.js";

export async function buildFinalWorkflowPayload({
  workflowRunId = "",
  options = {},
  ctx = {},
  sourceText = "",
  semanticText = "",
  semantic = null,
  execution = null,
  semanticResolution = {},
  phaseTracker,
  retryMeta = {},
  nodeAgentRuns = [],
  nodeStateSnapshot = null,
  planningPersistResult = null,
} = {}) {
  phaseTracker.start(WORKFLOW_PHASES.PAYLOAD_BUILD);
  throwIfWorkflowAborted(ctx);

  const workflowPayload = buildWorkflowOrchestrationPayload({
    workflowRunId,
    ctx,
    options,
    sourceText,
    semanticText,
    semantic,
    execution,
    semanticResolution,
    phaseTimeline: phaseTracker.list(),
    retryMeta,
  });
  phaseTracker.end(WORKFLOW_PHASES.PAYLOAD_BUILD, WORKFLOW_PHASE_STATUS.SUCCEEDED);
  workflowPayload.phaseTimeline = phaseTracker.list();
  enrichWorkflowPayload({
    workflowPayload,
    ctx,
    semantic,
    nodeAgentRuns,
    nodeStateSnapshot,
    planningPersistResult,
  });

  return {
    workflowPayload,
  };
}
