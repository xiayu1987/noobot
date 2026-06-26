/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { appendWorkflowPlanningMessage, emitWorkflowRuntimeEvent } from "../hooks/persistence.js";
import { buildWorkflowOrchestrationPayload } from "../orchestration-payload.js";

export function createPlanningExecutionStub() {
  return {
    started: false,
    instanceId: "",
    autoTransitions: 0,
    completed: false,
    pendingStepCount: 0,
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
} = {}) {
  const planningWorkflowPayload = buildWorkflowOrchestrationPayload({
    ctx,
    options,
    sourceText,
    semanticText,
    semantic,
    execution: createPlanningExecutionStub(),
    semanticResolution,
    phaseTimeline: phaseTracker.list(),
    retryMeta,
  });
  attachPlanningDialog(planningWorkflowPayload, ctx, planningPersistResult);
  planningWorkflowPayload.nodeSessions = [];
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
      dialogProcessId: String(ctx?.dialogProcessId || "").trim(),
    },
  });
}
