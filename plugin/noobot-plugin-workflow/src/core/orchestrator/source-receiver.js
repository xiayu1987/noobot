/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_PHASE_STATUS, WORKFLOW_PHASES } from "../constants.js";
import { throwIfWorkflowAborted } from "../hooks/runtime.js";
import { resolveWorkflowSourceText } from "../hooks/messages.js";
import { startWorkflowPhase, endWorkflowPhase } from "./phase-events.js";

export async function receiveWorkflowSource({
  options = {},
  ctx = {},
  sourceAgentResult = {},
  hookPoint = "",
  phaseTracker,
} = {}) {
  await startWorkflowPhase({
    phaseTracker,
    phase: WORKFLOW_PHASES.HOOK_RECEIVED,
    options,
    ctx,
    event: "workflow_hook_received_started",
  });
  throwIfWorkflowAborted(ctx);

  const sourceText = resolveWorkflowSourceText(ctx, sourceAgentResult, hookPoint);
  if (!sourceText) {
    await endWorkflowPhase({
      phaseTracker,
      phase: WORKFLOW_PHASES.HOOK_RECEIVED,
      status: WORKFLOW_PHASE_STATUS.SKIPPED,
      meta: { reason: "empty_source_text" },
      options,
      ctx,
      event: "workflow_hook_received_skipped",
      data: { reason: "empty_source_text" },
    });
    return { sourceText: "", skipped: true };
  }

  await endWorkflowPhase({
    phaseTracker,
    phase: WORKFLOW_PHASES.HOOK_RECEIVED,
    status: WORKFLOW_PHASE_STATUS.SUCCEEDED,
    meta: { sourceTextLength: sourceText.length },
    options,
    ctx,
    event: "workflow_hook_received_succeeded",
    data: { sourceTextLength: sourceText.length },
  });
  throwIfWorkflowAborted(ctx);

  return { sourceText, skipped: false };
}
