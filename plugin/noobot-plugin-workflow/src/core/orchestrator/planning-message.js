/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { appendWorkflowPlanningMessage, emitWorkflowRuntimeEvent } from "../hooks/persistence.js";
import { buildWorkflowOrchestrationPayload } from "../orchestration-payload.js";

export function createPlanningExecutionStub({ workflowRunId = "", nodeSessions = [] } = {}) {
  return {
    started: false,
    instanceId: workflowRunId,
    workflowRunId,
    autoTransitions: 0,
    completed: false,
    pendingStepCount: nodeSessions.filter((item) => ["pending", "ready"].includes(item?.stepStatus)).length,
    actionRecords: [],
    nodeAgentRuns: [],
  };
}

export function attachPlanningDialog(payload = {}, ctx = {}, planningPersistResult = null) {
  payload.planningDialog = {
    dialogProcessId: String(ctx?.dialogProcessId || "").trim(),
    sessionId: String(ctx?.sessionId || "").trim(),
    storagePath: String(planningPersistResult?.outputDir || "").trim(),
    storageFile: String(planningPersistResult?.outputFile || "").trim(),
  };
  return payload;
}

export async function prepareWorkflowPlanningMessage({
  options = {},
  ctx = {},
  agentResult = {},
  sourceText = "",
  semanticText = "",
  semantic = null,
  semanticResolution = {},
  phaseTracker,
  retryMeta = {},
  planningPersistResult = null,
  workflowRunId = "",
  planningNodeSessions = [],
} = {}) {
  const planningWorkflowPayload = buildWorkflowOrchestrationPayload({
    ctx,
    options,
    sourceText,
    semanticText,
    semantic,
    execution: createPlanningExecutionStub({ workflowRunId, nodeSessions: planningNodeSessions }),
    semanticResolution,
    phaseTimeline: phaseTracker.list(),
    retryMeta,
  });
  attachPlanningDialog(planningWorkflowPayload, ctx, planningPersistResult);
  planningWorkflowPayload.workflowRunId = workflowRunId;
  planningWorkflowPayload.nodeSessions = planningNodeSessions;
  planningWorkflowPayload.attachments = [];
  await appendWorkflowPlanningMessage({
    options,
    agentResult,
    ctx,
    sourceText,
    semanticText,
    semanticResolution,
    workflowPayload: planningWorkflowPayload,
    attachments: [],
  });
  await emitWorkflowRuntimeEvent({
    options,
    ctx,
    event: "workflow_planning_message_prepared",
    data: {
      sessionId: String(ctx?.sessionId || "").trim(),
      dialogProcessId: String(ctx?.dialogProcessId || "").trim(),
      turnScopeId: String(ctx?.turnScopeId || "").trim(),
      workflowRunId,
      semanticText,
      nodeSessions: planningNodeSessions,
    },
  });
  if (typeof ctx?.eventListener?.onEvent === "function") {
    await ctx.eventListener.onEvent({
      event: "workflow_planning_message_prepared",
      data: {
        sessionId: String(ctx?.sessionId || "").trim(),
        dialogProcessId: String(ctx?.dialogProcessId || "").trim(),
        turnScopeId: String(ctx?.turnScopeId || "").trim(),
        workflowRunId,
        semanticText,
        nodeSessions: planningNodeSessions,
      },
    });
  }
}
