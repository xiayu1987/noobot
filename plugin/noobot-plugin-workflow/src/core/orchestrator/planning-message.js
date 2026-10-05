/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { appendWorkflowPlanningMessage } from "../hooks/persistence.js";
import { commitWorkflowRuntimeEvent } from "../hooks/authority-event-commit.js";
import { buildWorkflowOrchestrationPayload } from "../orchestration-payload.js";
import {
  WORKFLOW_RUNTIME_EVENT,
  WORKFLOW_SEQUENCE_DOMAIN,
} from "@noobot/event-protocol/workflow-runtime-event";
import { resolveWorkflowParentRunConfig } from "../hooks/runtime.js";

function createPlanningExecutionStub({ workflowRunId = "", nodeSessions = [] } = {}) {
  return {
    started: false,
    instanceId: workflowRunId,
    workflowRunId,
    autoTransitions: 0,
    completed: false,
    pendingStepCount: nodeSessions.filter((item) => ["pending", "ready"].includes(item?.status))
      .length,
    actionRecords: [],
    nodeAgentRuns: [],
  };
}

function attachPlanningDialog(payload = {}, ctx = {}, planningPersistResult = null) {
  payload.planningDialog = {
    dialogProcessId: String(ctx?.dialogProcessId || "").trim(),
    sessionId: String(ctx?.sessionId || "").trim(),
    storagePath: String(planningPersistResult?.outputDir || "").trim(),
    storageFile: String(planningPersistResult?.outputFile || "").trim(),
  };
  return payload;
}

function resolvePlanningIdentity(ctx = {}, workflowMessage = null) {
  const parentRunConfig = resolveWorkflowParentRunConfig(ctx);
  return {
    turnScopeId: String(ctx?.turnScopeId || parentRunConfig?.turnScopeId || "").trim(),
    messageId: String(
      ctx?.messageId || ctx?.runConfig?.messageId || parentRunConfig?.messageId || "",
    ).trim(),
    presentationMessageId: String(
      workflowMessage?.presentationMessageId || parentRunConfig?.presentationMessageId || "",
    ).trim(),
  };
}

function countArray(value) {
  return Array.isArray(value) ? value.length : 0;
}

function pickPluginMetaText(pluginMeta) {
  return {
    pluginSource: String(pluginMeta?.source || ""),
    pluginKind: String(pluginMeta?.kind || ""),
    pluginPhase: String(pluginMeta?.phase || ""),
  };
}

function resolveSourceWorkflowRunId(pluginMeta) {
  return String(
    pluginMeta?.payload?.workflowRunId || pluginMeta?.payload?.execution?.workflowRunId || "",
  );
}

function buildPlanningSourceMessage(
  workflowMessage,
  payload,
  { presentationMessageId, messageId },
) {
  const pluginMeta = workflowMessage?.pluginMeta;
  return {
    role: String(workflowMessage?.role || ""),
    type: String(workflowMessage?.type || ""),
    pluginMessage: workflowMessage?.pluginMessage === true,
    ...pickPluginMetaText(pluginMeta),
    presentationMessageId,
    messageId,
    workflowRunId: resolveSourceWorkflowRunId(pluginMeta),
    contentLength: String(workflowMessage?.content || "").length,
    semanticNodeCount: countArray(payload?.semantic?.nodes),
    semanticFlowtoCount: countArray(payload?.semantic?.flowtos),
  };
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
  const identity = resolvePlanningIdentity(ctx, workflowMessage);
  const { turnScopeId, messageId, presentationMessageId } = identity;
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
    sourceMessage: buildPlanningSourceMessage(workflowMessage, planningWorkflowPayload, identity),
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
