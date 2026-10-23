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
import { text } from "@noobot/shared/value";

const CHILD_TERMINAL_NODE_STATUS = Object.freeze({
  completed: WORKFLOW_NODE_STATUS.SUCCEEDED,
  stop_completed: WORKFLOW_NODE_STATUS.STOPPED,
  action_failed: WORKFLOW_NODE_STATUS.FAILED,
  processing_failed: WORKFLOW_NODE_STATUS.FAILED,
  completion_failed: WORKFLOW_NODE_STATUS.FAILED,
  stop_failed: WORKFLOW_NODE_STATUS.FAILED,
});

export const CHILD_TERMINAL_RECEIPT_INVALID_CODE = "WORKFLOW_CHILD_TERMINAL_RECEIPT_INVALID";

export function resolveCommittedChildTerminal(subSession = {}, expectedExecutionId = "") {
  const lifecycle =
    subSession?.lifecycle && typeof subSession.lifecycle === "object" ? subSession.lifecycle : null;
  const fail = (reason) => {
    const error = new Error(`invalid child execution terminal receipt: ${reason}`);
    error.code = CHILD_TERMINAL_RECEIPT_INVALID_CODE;
    error.receiptReason = reason;
    throw error;
  };
  if (!lifecycle) return fail("missing_lifecycle");
  if (text(lifecycle.executionId) !== text(expectedExecutionId)) {
    return fail("execution_identity_mismatch");
  }
  if (text(lifecycle.executionKind) !== "agent") {
    return fail("execution_kind_mismatch");
  }
  if (!Number.isInteger(lifecycle.revision) || lifecycle.revision < 1) {
    return fail("invalid_revision");
  }
  if (!Number.isInteger(lifecycle.sequence) || lifecycle.sequence < 1) {
    return fail("invalid_sequence");
  }
  const state = text(lifecycle.state).toLowerCase();
  const nodeStatus = CHILD_TERMINAL_NODE_STATUS[state];
  if (!nodeStatus) return fail("non_terminal_state");
  return { lifecycle, nodeStatus };
}

async function publishWorkflowNodeStateCommitted({ ctx, node }) {
  return commitWorkflowRuntimeEvent({
    ctx,
    eventType: WORKFLOW_RUNTIME_EVENT.NODE_STATE,
    commandId: node.commandId,
    payload: {
      workflowRunId: node.workflowRunId,
      commandId: node.commandId,
      nodeSessionId: node.nodeSessionId,
      dialogProcessId: node.dialogProcessId,
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
    },
    orderingDomain: WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE,
    orderingScopeId: node.workflowRunId,
    revision: node.revision,
    executionId: node.nodeExecutionId,
  });
}

export async function commitAndPublishWorkflowNodeState({ repository, ctx, transition }) {
  const fact = await repository.commit(transition);
  await publishWorkflowNodeStateCommitted({ ctx, node: fact.node });
  return fact;
}

const UNSTARTED_SETTLE_FAILURE = Object.freeze({
  [WORKFLOW_NODE_STATUS.STOPPED]: {
    source: "workflow",
    code: "WORKFLOW_STOPPED",
    message: "workflow stopped before node execution",
  },
  [WORKFLOW_NODE_STATUS.SKIPPED]: undefined,
});

export async function settleUnstartedWorkflowNodes({ repository, workflowRunId, ctx, status }) {
  if (!Object.hasOwn(UNSTARTED_SETTLE_FAILURE, status)) {
    throw new Error(`unsupported unstarted workflow node settle status: ${status}`);
  }
  let latest = await repository.getSnapshot({ workflowRunId });
  for (const node of latest.nodes) {
    if (![WORKFLOW_NODE_STATUS.PENDING, WORKFLOW_NODE_STATUS.READY].includes(node.status)) continue;
    const fact = await commitAndPublishWorkflowNodeState({
      repository,
      ctx,
      transition: {
        workflowRunId,
        nodeExecutionId: node.nodeExecutionId,
        status,
        expectedRevision: node.revision,
        failure: UNSTARTED_SETTLE_FAILURE[status],
      },
    });
    latest = fact.snapshot;
  }
  return latest;
}
