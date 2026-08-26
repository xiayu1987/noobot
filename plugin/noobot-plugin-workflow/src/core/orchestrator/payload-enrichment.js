/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { normalizeWorkflowTransferPayload } from "../hooks/attachments.js";
import { resolveSemanticNodeForPendingStep } from "../hooks/node-agent.js";
import { resolveWorkflowNodeDialogProcessId } from "../node-dialog-process-id.js";

function text(value) {
  return String(value || "").trim();
}

function finiteNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : undefined;
}

function nodeExecutionId(item = {}) {
  return text(item?.nodeIdentity?.nodeExecutionId || item?.nodeExecutionId);
}

function resolveNodeState(nodeStates, item) {
  return nodeStates.get(nodeExecutionId(item)) || {};
}

function resolveNodeSemantic(semantic, item) {
  return resolveSemanticNodeForPendingStep({ semantic, pendingStep: item?.step || {} });
}

function resolveAttemptExecutionIds(nodeState) {
  return Array.isArray(nodeState?.attemptExecutionIds)
    ? nodeState.attemptExecutionIds.map(text).filter(Boolean)
    : [];
}

function resolveFailure(value) {
  return value && typeof value === "object" ? value : null;
}

function buildNodeSessionRecord({ ctx, item, nodeState, semanticNode }) {
  const step = item?.step || {};
  return {
    transition: Number(item?.transition || 0),
    workflowRunId: text(nodeState?.workflowRunId || item?.workflowRunId),
    nodeExecutionId: text(nodeState?.nodeExecutionId || item?.nodeExecutionId),
    commandId: text(nodeState?.commandId || item?.commandId),
    turnScopeId: text(nodeState?.turnScopeId || item?.turnScopeId),
    parentSessionId: text(ctx?.sessionId),
    nodeName: text(step?.nodeName || semanticNode?.name),
    nodeId: text(step?.nodeId || semanticNode?.id),
    nodeType: finiteNumber(step?.nodeType),
    actionNodeStateId: text(item?.actionNodeStateId || step?.actionNodeStateId),
    stepId: text(item?.stepId || step?.stepId),
    stepIndex: finiteNumber(item?.stepIndex ?? step?.stepIndex),
    type: text(semanticNode?.type),
    stateType: finiteNumber(semanticNode?.stateType),
    rootSessionId: text(ctx?.sessionId),
    dialogProcessId: resolveWorkflowNodeDialogProcessId(item),
    agentDialogProcessId: text(nodeState?.agentDialogProcessId || item?.agentDialogProcessId),
    sessionId: text(nodeState?.nodeSessionId || item?.nodeSessionId),
    activeChildExecutionId: text(nodeState?.activeChildExecutionId),
    attemptExecutionIds: resolveAttemptExecutionIds(nodeState),
    status: text(nodeState?.status),
    failure: resolveFailure(nodeState?.failure),
    revision: Number(nodeState?.revision || 0),
    sequence: Number(nodeState?.sequence || 0),
    eventId: text(nodeState?.eventId),
    startedAt: text(nodeState?.startedAt),
    completedAt: text(nodeState?.completedAt),
    updatedAt: text(nodeState?.updatedAt),
    transferEnvelopes: Array.isArray(item?.nodeResultTransferEnvelopes)
      ? item.nodeResultTransferEnvelopes
      : [],
    stepFailure: resolveFailure(item?.stepFailure),
    parallelWave: Number(item?.parallelWave || 0),
    waveOrder: Number(item?.waveOrder || 0),
  };
}

function hasNodeSessionIdentity(item) {
  return Boolean(
    item.dialogProcessId ||
    item.sessionId ||
    item.stepId ||
    item.actionNodeStateId ||
    item.nodeId ||
    item.nodeName,
  );
}

export function buildWorkflowNodeSessions({
  ctx = {},
  semantic = {},
  nodeAgentRuns = [],
  nodeStateSnapshot = null,
} = {}) {
  const nodeStates = new Map(
    (Array.isArray(nodeStateSnapshot?.nodes) ? nodeStateSnapshot.nodes : [])
      .map((item = {}) => [String(item?.nodeExecutionId || "").trim(), item])
      .filter(([nodeExecutionId]) => nodeExecutionId),
  );
  return (Array.isArray(nodeAgentRuns) ? nodeAgentRuns : [])
    .map((item = {}) => {
      return buildNodeSessionRecord({
        ctx,
        item,
        nodeState: resolveNodeState(nodeStates, item),
        semanticNode: resolveNodeSemantic(semantic, item),
      });
    })
    .filter(hasNodeSessionIdentity);
}

export function resolveWorkflowTransferEnvelopesFromNodeRuns(nodeAgentRuns = []) {
  return (Array.isArray(nodeAgentRuns) ? nodeAgentRuns : []).flatMap((item = {}) => {
    if (
      Array.isArray(item?.nodeResultTransferEnvelopes) &&
      item.nodeResultTransferEnvelopes.length
    ) {
      return item.nodeResultTransferEnvelopes;
    }
    return [];
  });
}

export function enrichWorkflowPayload({
  workflowPayload = {},
  ctx = {},
  semantic = {},
  nodeAgentRuns = [],
  nodeStateSnapshot = null,
  planningPersistResult = null,
} = {}) {
  workflowPayload.planningDialog = {
    dialogProcessId: String(ctx?.dialogProcessId || "").trim(),
    sessionId: String(ctx?.sessionId || "").trim(),
    storagePath: String(planningPersistResult?.outputDir || "").trim(),
    storageFile: String(planningPersistResult?.outputFile || "").trim(),
  };
  workflowPayload.nodeSessions = buildWorkflowNodeSessions({
    ctx,
    semantic,
    nodeAgentRuns,
    nodeStateSnapshot,
  });
  workflowPayload.transferEnvelopes = resolveWorkflowTransferEnvelopesFromNodeRuns(nodeAgentRuns);
  return {
    workflowPayload,
  };
}
