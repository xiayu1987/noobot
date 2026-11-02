/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { throwIfWorkflowAborted } from "../hooks/runtime.js";
import { buildWorkflowOrchestrationPayload } from "../orchestration-payload.js";
import { enrichWorkflowPayload } from "./payload-enrichment.js";

export async function buildFinalWorkflowPayload({
  workflowRunId,
  ctx,
  signal,
  semanticText,
  semantic,
  nodeAgentRuns,
  nodeStateSnapshot,
}) {
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
  return enriched;
}
