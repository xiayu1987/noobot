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
import { text } from "@noobot/shared/value";

function finiteNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : undefined;
}

function resolveNodeState(nodeStates, item) {
  const nodeState = nodeStates.get(item.nodeExecutionId);
  if (!nodeState) throw new Error(`workflow node state not found: ${item.nodeExecutionId}`);
  return nodeState;
}

function count(value) {
  return Number(value || 0);
}

function buildRunIdentityFields(state, run) {
  return {
    transition: count(run.transition),
    workflowRunId: state.workflowRunId,
    nodeExecutionId: state.nodeExecutionId,
    commandId: state.commandId,
    turnScopeId: state.turnScopeId,
  };
}

function buildStepIdentityFields(run, state, node) {
  return {
    nodeName: state.nodeName,
    nodeId: state.nodeId,
    nodeType: finiteNumber(run.step.nodeType),
    actionNodeStateId: run.actionNodeStateId,
    stepId: run.stepId,
    stepIndex: run.stepIndex,
    type: text(node.type),
    stateType: finiteNumber(node.stateType),
  };
}

function buildNodeStateFields(state) {
  return {
    activeChildExecutionId: state.activeChildExecutionId,
    attemptExecutionIds: state.attemptExecutionIds,
    status: state.status,
    failure: state.failure,
    revision: state.revision,
    sequence: state.sequence,
    eventId: state.eventId,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    updatedAt: state.updatedAt,
  };
}

function buildNodeSessionRecord({ ctx, item: run, nodeState: state, semanticNode }) {
  const rootSessionId = text(ctx?.sessionId);
  return {
    ...buildRunIdentityFields(state, run),
    parentSessionId: rootSessionId,
    ...buildStepIdentityFields(run, state, semanticNode),
    rootSessionId,
    dialogProcessId: state.dialogProcessId,
    sessionId: state.nodeSessionId,
    ...buildNodeStateFields(state),
    transferEnvelopes: pickTransferEnvelopeList(run, TRANSFER_ENVELOPE_FIELD.NODE_RESULT),
    parallelWave: count(run.parallelWave),
    waveOrder: count(run.waveOrder),
  };
}

function buildWorkflowNodeSessions({ ctx, semantic, nodeAgentRuns, nodeStateSnapshot }) {
  const nodeStates = new Map(nodeStateSnapshot.nodes.map((node) => [node.nodeExecutionId, node]));
  return nodeAgentRuns.map((item) =>
    buildNodeSessionRecord({
      ctx,
      item,
      nodeState: resolveNodeState(nodeStates, item),
      semanticNode: resolveSemanticNodeForPendingStep({ semantic, pendingStep: item.step }),
    }),
  );
}

function resolveWorkflowTransferEnvelopesFromNodeRuns(nodeAgentRuns) {
  return collectTransferEnvelopeLists(nodeAgentRuns, TRANSFER_ENVELOPE_FIELD.NODE_RESULT);
}

export function enrichWorkflowPayload({
  workflowPayload,
  ctx,
  semantic,
  nodeAgentRuns,
  nodeStateSnapshot,
}) {
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
