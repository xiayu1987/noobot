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
  workflowRunId,
  ctx,
  signal,
  semanticText,
  semantic,
  phaseTracker,
  nodeAgentRuns,
  nodeStateSnapshot,
}) {
  phaseTracker.start(WORKFLOW_PHASES.PAYLOAD_BUILD);
  throwIfWorkflowAborted(signal);
  const enriched = enrichWorkflowPayload({
    workflowPayload: buildWorkflowOrchestrationPayload({
      workflowRunId,
      ctx,
      semanticText,
      semantic,
    }),
    nodeAgentRuns,
    nodeStateSnapshot,
  });
  phaseTracker.end(WORKFLOW_PHASES.PAYLOAD_BUILD, WORKFLOW_PHASE_STATUS.SUCCEEDED);
  return enriched;
}
