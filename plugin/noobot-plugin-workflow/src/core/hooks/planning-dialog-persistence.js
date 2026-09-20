/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isWorkflowNodeDialogProcessId } from "@noobot/session-protocol/turn-scope-identity";
import { normalizeString } from "./runtime.js";

export function buildWorkflowDialogRelativeDir({
  ctx = {},
  dialogProcessId = "",
  scope = "auto",
} = {}) {
  const sessionId = String(ctx?.sessionId || "").trim();
  const resolvedDialogProcessId = String(dialogProcessId || ctx?.dialogProcessId || "").trim();
  if (!sessionId || !resolvedDialogProcessId) return "";
  const normalizedScope = String(scope || "auto")
    .trim()
    .toLowerCase();
  if (normalizedScope === "planning") {
    return `runtime/workflow/planning/${sessionId}/${resolvedDialogProcessId}`;
  }
  if (normalizedScope === "node") {
    return `runtime/workflow/session/${sessionId}/${resolvedDialogProcessId}`;
  }
  const isNodeDialog = isWorkflowNodeDialogProcessId(resolvedDialogProcessId);
  return isNodeDialog
    ? `runtime/workflow/session/${sessionId}/${resolvedDialogProcessId}`
    : `runtime/workflow/planning/${sessionId}/${resolvedDialogProcessId}`;
}

function projectPlanningSemanticResolution(semanticResolution) {
  return {
    invoked: semanticResolution?.invoked === true,
    traceCount: Number(semanticResolution?.traceCount || 0),
    requestMessages: Array.isArray(semanticResolution?.requestMessages)
      ? semanticResolution.requestMessages
      : [],
  };
}

function buildWorkflowPlanningDialogPayload({
  ctx,
  userId,
  options,
  sourceText,
  semanticText,
  semantic,
  semanticResolution,
  workflowRunId,
  planningNodeSessions,
}) {
  return {
    scope: "workflow_planning",
    userId,
    sessionId: normalizeString(ctx?.sessionId),
    dialogProcessId: normalizeString(ctx?.dialogProcessId),
    workflowRunId: normalizeString(workflowRunId),
    revision: 1,
    sequence: 1,
    timestamp: new Date().toISOString(),
    sourceText,
    semanticText,
    semantic,
    nodeSessions: Array.isArray(planningNodeSessions) ? planningNodeSessions : [],
    semanticModel: normalizeString(options?.semanticModel),
    semanticPrompt: normalizeString(options?.semanticPrompt),
    semanticResolution: projectPlanningSemanticResolution(semanticResolution),
  };
}

export async function persistWorkflowPlanningDialog({
  options = {},
  ctx = {},
  sourceText = "",
  semanticText = "",
  semantic = null,
  semanticResolution = {},
  workflowRunId = "",
  planningNodeSessions = [],
} = {}) {
  if (typeof options?.workflowDialogPersister !== "function") return null;
  const userId = normalizeString(ctx?.userId);
  if (!userId) return null;
  const relativeDir = buildWorkflowDialogRelativeDir({
    ctx,
    dialogProcessId: normalizeString(ctx?.dialogProcessId),
    scope: "planning",
  });
  if (!relativeDir) return null;
  try {
    return await options.workflowDialogPersister({
      userId,
      relativeDir,
      fileName: "planning.json",
      payload: buildWorkflowPlanningDialogPayload({
        ctx,
        userId,
        options,
        sourceText,
        semanticText,
        semantic,
        semanticResolution,
        workflowRunId,
        planningNodeSessions,
      }),
    });
  } catch {
    return null;
  }
}
