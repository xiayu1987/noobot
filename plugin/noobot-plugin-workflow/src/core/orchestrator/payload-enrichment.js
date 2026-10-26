/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  TRANSFER_ENVELOPE_FIELD,
  mergeTransferEnvelopes,
  readTransferEnvelopeList,
} from "@noobot/semantic-transfer-protocol";

function buildNodeStateFields(state) {
  return {
    workflowRunId: state.workflowRunId,
    nodeExecutionId: state.nodeExecutionId,
    commandId: state.commandId,
    turnScopeId: state.turnScopeId,
    nodeId: state.nodeId,
    nodeName: state.nodeName,
    dialogProcessId: state.dialogProcessId,
    nodeSessionId: state.nodeSessionId,
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

function buildNodeRunFields(run) {
  return {
    transition: run.transition,
    actionNodeStateId: run.actionNodeStateId,
    stepId: run.stepId,
    stepIndex: run.stepIndex,
    parallelWave: run.parallelWave,
    waveOrder: run.waveOrder,
  };
}

function indexNodeRunsByExecutionId(nodeAgentRuns) {
  const runs = new Map();
  for (const run of nodeAgentRuns) {
    if (runs.has(run.nodeExecutionId)) {
      throw new Error(`duplicate workflow node run: ${run.nodeExecutionId}`);
    }
    runs.set(run.nodeExecutionId, run);
  }
  return runs;
}

function buildWorkflowNodeSessions({ nodeAgentRuns, nodeStateSnapshot }) {
  const runs = indexNodeRunsByExecutionId(nodeAgentRuns);
  return nodeStateSnapshot.nodes.map((state) => {
    const run = runs.get(state.nodeExecutionId);
    return run
      ? { ...buildNodeStateFields(state), ...buildNodeRunFields(run) }
      : buildNodeStateFields(state);
  });
}

function resolveWorkflowTransferEnvelopesFromNodeRuns(nodeAgentRuns) {
  return mergeTransferEnvelopes(
    ...nodeAgentRuns.map((run) =>
      readTransferEnvelopeList(run, TRANSFER_ENVELOPE_FIELD.NODE_RESULT),
    ),
  );
}

export function enrichWorkflowPayload({ workflowPayload, nodeAgentRuns, nodeStateSnapshot }) {
  return {
    workflowPayload: {
      ...workflowPayload,
      nodeSessions: buildWorkflowNodeSessions({ nodeAgentRuns, nodeStateSnapshot }),
    },
    nodeTransferEnvelopes: resolveWorkflowTransferEnvelopesFromNodeRuns(nodeAgentRuns),
  };
}
