/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  WORKFLOW_RUNTIME_EVENT,
  WORKFLOW_SEQUENCE_DOMAIN,
} from "@noobot/event-protocol/workflow-runtime-event";
import { commitWorkflowRuntimeEvent } from "../hooks/authority-event-commit.js";
import { WORKFLOW_NODE_STATUS } from "./node-state-repository.js";

const CHILD_TERMINAL_NODE_STATUS = Object.freeze({
  completed: WORKFLOW_NODE_STATUS.SUCCEEDED,
  stop_completed: WORKFLOW_NODE_STATUS.STOPPED,
  action_failed: WORKFLOW_NODE_STATUS.FAILED,
  processing_failed: WORKFLOW_NODE_STATUS.FAILED,
  completion_failed: WORKFLOW_NODE_STATUS.FAILED,
  stop_failed: WORKFLOW_NODE_STATUS.FAILED,
});

export function resolveCommittedChildTerminal(subSession = {}, expectedExecutionId = "") {
  const lifecycle =
    subSession?.lifecycle && typeof subSession.lifecycle === "object" ? subSession.lifecycle : null;
  const fail = (reason) => {
    const error = new Error(`invalid child execution terminal receipt: ${reason}`);
    error.code = "WORKFLOW_CHILD_TERMINAL_RECEIPT_INVALID";
    error.receiptReason = reason;
    error.nodeTerminalReceiptRejected = true;
    throw error;
  };
  if (!lifecycle) return fail("missing_lifecycle");
  if (String(lifecycle.executionId || "").trim() !== String(expectedExecutionId || "").trim()) {
    return fail("execution_identity_mismatch");
  }
  if (
    String(lifecycle.executionKind || "agent")
      .trim()
      .toLowerCase() !== "agent"
  ) {
    return fail("execution_kind_mismatch");
  }
  if (!Number.isInteger(lifecycle.revision) || lifecycle.revision < 1) {
    return fail("invalid_revision");
  }
  if (!Number.isInteger(lifecycle.sequence) || lifecycle.sequence < 1) {
    return fail("invalid_sequence");
  }
  const state = String(lifecycle.state || "")
    .trim()
    .toLowerCase();
  const nodeStatus = CHILD_TERMINAL_NODE_STATUS[state];
  if (!nodeStatus) return fail("non_terminal_state");
  return { lifecycle, nodeStatus };
}

async function publishWorkflowNodeStateCommitted({ ctx = {}, fact = null } = {}) {
  const node = fact?.node && typeof fact.node === "object" ? fact.node : null;
  if (!node) return null;
  return commitWorkflowRuntimeEvent({
    ctx,
    eventType: WORKFLOW_RUNTIME_EVENT.NODE_STATE,
    payload: {
      workflowRunId: node.workflowRunId,
      nodeExecutionId: node.nodeExecutionId,
      commandId: node.commandId,
      nodeSessionId: node.nodeSessionId,
      dialogProcessId: node.dialogProcessId,
      agentDialogProcessId: node.agentDialogProcessId,
      turnScopeId: node.turnScopeId,
      nodeId: node.nodeId,
      nodeName: node.nodeName,
      status: node.status,
      failure: node.failure,
      activeChildExecutionId: node.activeChildExecutionId,
      attemptExecutionIds: node.attemptExecutionIds,
      startedAt: node.startedAt,
      completedAt: node.completedAt,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      applied: fact.applied === true,
      deduplicated: fact.deduplicated === true,
    },
    orderingDomain: WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE,
    orderingScopeId: node.workflowRunId,
    revision: node.revision,
    executionId: node.nodeExecutionId,
  });
}

export async function commitAndPublishWorkflowNodeState({
  repository,
  ctx = {},
  workflowRunId = "",
  nodeExecutionId = "",
  status = "",
  expectedRevision = null,
  nodeSessionId = "",
  agentDialogProcessId = "",
  childExecutionId = "",
  failure = null,
} = {}) {
  const fact = await repository.commit({
    workflowRunId,
    nodeExecutionId,
    status,
    expectedRevision,
    nodeSessionId,
    agentDialogProcessId,
    childExecutionId,
    failure,
  });
  if (fact?.applied === true) {
    await publishWorkflowNodeStateCommitted({ ctx, fact });
  }
  return fact;
}

export async function settleUnstartedWorkflowNodes({
  repository,
  snapshot,
  ctx = {},
  status,
} = {}) {
  if (
    !repository ||
    !snapshot ||
    ![WORKFLOW_NODE_STATUS.STOPPED, WORKFLOW_NODE_STATUS.SKIPPED].includes(status)
  ) {
    return snapshot;
  }
  let latest =
    (await repository.getSnapshot({ workflowRunId: snapshot.workflowRunId })) || snapshot;
  for (const node of latest.nodes || []) {
    if (![WORKFLOW_NODE_STATUS.PENDING, WORKFLOW_NODE_STATUS.READY].includes(node?.status))
      continue;
    const fact = await commitAndPublishWorkflowNodeState({
      repository,
      ctx,
      workflowRunId: node.workflowRunId,
      nodeExecutionId: node.nodeExecutionId,
      status,
      expectedRevision: node.revision,
      failure:
        status === WORKFLOW_NODE_STATUS.STOPPED
          ? {
              name: "AbortError",
              code: "WORKFLOW_STOPPED",
              message: "workflow stopped before node execution",
            }
          : null,
    });
    latest = fact?.snapshot || latest;
  }
  return latest;
}
