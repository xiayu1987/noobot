/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_PHASE_STATUS, WORKFLOW_PHASES } from "../constants.js";
import { throwIfWorkflowAborted } from "../hooks/runtime.js";
import { emitWorkflowRuntimeEvent } from "../hooks/persistence.js";
import { buildWorkflowOrchestrationPayload } from "../orchestration-payload.js";
import { enrichWorkflowPayload } from "./payload-enrichment.js";

export async function buildFinalWorkflowPayload({
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
  planningPersistResult = null,
} = {}) {
  phaseTracker.start(WORKFLOW_PHASES.PAYLOAD_BUILD);
  throwIfWorkflowAborted(ctx);

  const workflowPayload = buildWorkflowOrchestrationPayload({
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
  await emitWorkflowRuntimeEvent({
    options,
    ctx,
    event: "workflow_payload_build_succeeded",
    data: {
      interactionId: String(workflowPayload?.interactionId || "").trim(),
    },
  });

  const { workflowAttachments } = enrichWorkflowPayload({
    workflowPayload,
    ctx,
    semantic,
    nodeAgentRuns,
    planningPersistResult,
  });

  return {
    workflowPayload,
    workflowAttachments,
  };
}
