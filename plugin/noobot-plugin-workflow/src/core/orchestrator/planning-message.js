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
import { resolveWorkflowRunIdentity } from "../workflow-run-identity.js";
import { text } from "@noobot/shared/value";

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
    dialogProcessId: text(ctx?.dialogProcessId),
    sessionId: text(ctx?.sessionId),
    storagePath: text(planningPersistResult?.outputDir),
    storageFile: text(planningPersistResult?.outputFile),
  };
  return payload;
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
  const identity = resolveWorkflowRunIdentity(ctx);
  const { turnScopeId, messageId, presentationMessageId, executionId } = identity;
  const runtimeData = {
    sessionId: text(ctx?.sessionId),
    dialogProcessId: text(ctx?.dialogProcessId),
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
    executionId,
  });
}
