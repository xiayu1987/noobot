/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { text, isCanonicalText } from "@noobot/shared/value";

export function buildWorkflowOrchestrationPayload({ workflowRunId, ctx, semanticText, semantic }) {
  if (!isCanonicalText(workflowRunId)) throw new TypeError("workflowRunId is required");
  return {
    workflowRunId,
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
