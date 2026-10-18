/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_PHASE_STATUS, WORKFLOW_PHASES } from "../constants.js";
import { throwIfWorkflowAborted } from "../hooks/runtime.js";
import { resolveSemanticText } from "./semantic-resolution.js";
import { startWorkflowPhase, endWorkflowPhase } from "./phase-events.js";
import { text } from "@noobot/shared/value";

export async function runSemanticResolutionStage({
  options = {},
  ctx = {},
  signal,
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
  throwIfWorkflowAborted(signal);

  const semanticResolution = await resolveSemanticText({ options, ctx, signal, sourceText });
  throwIfWorkflowAborted(signal);

  const semanticResolutionMeta = {
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
    semanticText: text(semanticResolution?.text),
  };
}
