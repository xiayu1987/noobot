/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { appendWorkflowPlanningMessage, commitWorkflowRuntimeEvent } from "../hooks/persistence.js";
import { buildWorkflowOrchestrationPayload } from "../orchestration-payload.js";
import {
  WORKFLOW_RUNTIME_EVENT,
  WORKFLOW_SEQUENCE_DOMAIN,
} from "@noobot/event-protocol/workflow-runtime-event";
import { resolveWorkflowParentRunConfig } from "../hooks/runtime.js";

export function createPlanningExecutionStub({ workflowRunId = "", nodeSessions = [] } = {}) {
  return {
    started: false,
    instanceId: workflowRunId,
    workflowRunId,
    autoTransitions: 0,
    completed: false,
    pendingStepCount: nodeSessions.filter((item) => ["pending", "ready"].includes(item?.status)).length,
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
    workflowRunId,
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
  planningWorkflowPayload.nodeSessions = planningNodeSessions;
  planningWorkflowPayload.attachments = [];
  const workflowMessage = await appendWorkflowPlanningMessage({
    options,
    agentResult,
    ctx,
    sourceText,
    semanticText,
    semanticResolution,
    workflowPayload: planningWorkflowPayload,
    attachments: [],
  });
  const parentRunConfig = resolveWorkflowParentRunConfig(ctx);
  const turnScopeId = String(ctx?.turnScopeId || parentRunConfig?.turnScopeId || "").trim();
  const messageId = String(ctx?.messageId || ctx?.runConfig?.messageId || parentRunConfig?.messageId || "").trim();
  const presentationMessageId = String(
    workflowMessage?.presentationMessageId || parentRunConfig?.presentationMessageId || "",
  ).trim();
  const runtimeData = {
    sessionId: String(ctx?.sessionId || "").trim(),
    dialogProcessId: String(ctx?.dialogProcessId || "").trim(),
    turnScopeId,
    messageId,
    presentationMessageId,
    workflowRunId,
    semanticText,
    workflowPayload: planningWorkflowPayload,
    nodeSessions: planningNodeSessions,
    sourceMessage: {
      role: String(workflowMessage?.role || ""),
      type: String(workflowMessage?.type || ""),
      pluginMessage: workflowMessage?.pluginMessage === true,
      pluginSource: String(workflowMessage?.pluginMeta?.source || ""),
      pluginKind: String(workflowMessage?.pluginMeta?.kind || ""),
      pluginPhase: String(workflowMessage?.pluginMeta?.phase || ""),
      presentationMessageId,
      messageId,
      workflowRunId: String(
        workflowMessage?.pluginMeta?.payload?.workflowRunId ||
          workflowMessage?.pluginMeta?.payload?.execution?.workflowRunId ||
          "",
      ),
      contentLength: String(workflowMessage?.content || "").length,
      semanticNodeCount: Array.isArray(planningWorkflowPayload?.semantic?.nodes)
        ? planningWorkflowPayload.semantic.nodes.length
        : 0,
      semanticFlowtoCount: Array.isArray(planningWorkflowPayload?.semantic?.flowtos)
        ? planningWorkflowPayload.semantic.flowtos.length
        : 0,
    },
  };
  await commitWorkflowRuntimeEvent({
    ctx,
    eventType: WORKFLOW_RUNTIME_EVENT.PLANNING,
    payload: runtimeData,
    orderingDomain: WORKFLOW_SEQUENCE_DOMAIN.PLANNING,
    orderingScopeId: workflowRunId,
    revision: 1,
    messageId,
    executionId: ctx?.workflowExecutionId,
  });
}
