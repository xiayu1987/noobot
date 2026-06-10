/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_PHASE_STATUS, WORKFLOW_PHASES } from "../constants.js";
import { throwIfWorkflowAborted } from "../hooks/runtime.js";
import { resolveSemanticText } from "./semantic-resolution.js";
import { startWorkflowPhase, endWorkflowPhase } from "./phase-events.js";

export async function runSemanticResolutionStage({
  options = {},
  ctx = {},
  sourceText = "",
  phaseTracker,
} = {}) {
  await startWorkflowPhase({
    phaseTracker,
    phase: WORKFLOW_PHASES.SEMANTIC_RESOLUTION,
    options,
    ctx,
    event: "workflow_semantic_resolution_started",
  });
  throwIfWorkflowAborted(ctx);

  const semanticResolution = await resolveSemanticText({ options, ctx, sourceText });
  throwIfWorkflowAborted(ctx);

  const semanticResolutionMeta = {
    invoked: semanticResolution?.invoked === true,
    traceCount: Number(semanticResolution?.traceCount || 0),
  };
  await endWorkflowPhase({
    phaseTracker,
    phase: WORKFLOW_PHASES.SEMANTIC_RESOLUTION,
    status: WORKFLOW_PHASE_STATUS.SUCCEEDED,
    meta: semanticResolutionMeta,
    options,
    ctx,
    event: "workflow_semantic_resolution_succeeded",
    data: semanticResolutionMeta,
  });

  return {
    semanticResolution,
    semanticText: String(semanticResolution?.text || "").trim(),
  };
}
