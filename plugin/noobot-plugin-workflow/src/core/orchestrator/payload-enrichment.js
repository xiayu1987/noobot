/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  TRANSFER_ENVELOPE_FIELD,
  collectTransferEnvelopeLists,
  pickTransferEnvelopeList,
} from "@noobot/semantic-transfer-protocol";
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

function count(value) {
  return Number(value || 0);
}

function preferText(primary, fallback, key) {
  return text(primary[key] || fallback[key]);
}

function buildRunIdentityFields(state, run) {
  return {
    transition: count(run.transition),
    workflowRunId: preferText(state, run, "workflowRunId"),
    nodeExecutionId: preferText(state, run, "nodeExecutionId"),
    commandId: preferText(state, run, "commandId"),
    turnScopeId: preferText(state, run, "turnScopeId"),
  };
}

function buildStepIdentityFields(run, step, node) {
  return {
    nodeName: text(step.nodeName || node.name),
    nodeId: text(step.nodeId || node.id),
    nodeType: finiteNumber(step.nodeType),
    actionNodeStateId: preferText(run, step, "actionNodeStateId"),
    stepId: preferText(run, step, "stepId"),
    stepIndex: finiteNumber(run.stepIndex ?? step.stepIndex),
    type: text(node.type),
    stateType: finiteNumber(node.stateType),
  };
}

function buildNodeStateFields(state) {
  return {
    activeChildExecutionId: text(state.activeChildExecutionId),
    attemptExecutionIds: resolveAttemptExecutionIds(state),
    status: text(state.status),
    failure: resolveFailure(state.failure),
    revision: count(state.revision),
    sequence: count(state.sequence),
    eventId: text(state.eventId),
    startedAt: text(state.startedAt),
    completedAt: text(state.completedAt),
    updatedAt: text(state.updatedAt),
  };
}

function buildNodeSessionRecord({ ctx, item, nodeState, semanticNode }) {
  const run = item || {};
  const state = nodeState || {};
  const rootSessionId = text(ctx?.sessionId);
  return {
    ...buildRunIdentityFields(state, run),
    parentSessionId: rootSessionId,
    ...buildStepIdentityFields(run, run.step || {}, semanticNode || {}),
    rootSessionId,
    dialogProcessId: resolveWorkflowNodeDialogProcessId(item),
    agentDialogProcessId: preferText(state, run, "agentDialogProcessId"),
    sessionId: preferText(state, run, "nodeSessionId"),
    ...buildNodeStateFields(state),
    transferEnvelopes: pickTransferEnvelopeList(item, TRANSFER_ENVELOPE_FIELD.NODE_RESULT),
    stepFailure: resolveFailure(run.stepFailure),
    parallelWave: count(run.parallelWave),
    waveOrder: count(run.waveOrder),
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

function buildWorkflowNodeSessions({
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

function resolveWorkflowTransferEnvelopesFromNodeRuns(nodeAgentRuns = []) {
  return collectTransferEnvelopeLists(nodeAgentRuns, TRANSFER_ENVELOPE_FIELD.NODE_RESULT);
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
