/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { text } from "@noobot/shared/value";

export function buildWorkflowOrchestrationPayload({ workflowRunId, ctx, semanticText, semantic }) {
  const resolvedWorkflowRunId = text(workflowRunId);
  if (!resolvedWorkflowRunId) throw new Error("workflowRunId is required");
  return {
    workflowRunId: resolvedWorkflowRunId,
    runMeta: {
      sessionId: ctx.sessionId,
      dialogProcessId: ctx.dialogProcessId,
    },
    semantic,
    interaction: {
      semanticTextPreview: text(semanticText).slice(
        0,
        LENGTH_THRESHOLDS.contextPreview.workflowSemanticTextPreviewChars,
      ),
    },
  };
}
