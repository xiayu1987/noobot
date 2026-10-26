/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createWorkflowNodeDialogProcessId,
  createWorkflowNodeTurnScopeId,
} from "@noobot/session-protocol/turn-scope-identity";
import { deriveAgentExecutionId, deriveTurnCommandId } from "@noobot/session-protocol";
import {
  WORKFLOW_NODE_STATUS,
  WORKFLOW_NODE_TYPE,
} from "@noobot/event-protocol/workflow-runtime-event";
import { isCanonicalText } from "@noobot/shared/value";

function requireCanonical(value, label) {
  if (!isCanonicalText(value)) throw new TypeError(`${label} is required`);
  return value;
}

function safeId(value) {
  return value.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
}

const WORKFLOW_ACCEPTED_RUN_FIELDS = Object.freeze([
  "commandId",
  "executionId",
  "rootExecutionId",
  "presentationMessageId",
]);

export function resolveWorkflowRunIdentity(ctx) {
  const { runConfig } = ctx;
  const identity = { turnScopeId: requireCanonical(ctx.turnScopeId, "workflow hook turnScopeId") };
  for (const field of WORKFLOW_ACCEPTED_RUN_FIELDS) {
    identity[field] = requireCanonical(runConfig[field], `workflow runConfig.${field}`);
  }
  return { ...identity, workflowRunId: identity.executionId };
}

export function createWorkflowNodeIdentity({ workflowRunId, node, attempt }) {
  requireCanonical(workflowRunId, "workflow run id");
  const nodeId = requireCanonical(node.id, "workflow node id");
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new TypeError("workflow node attempt must be a positive integer");
  }
  const nodeExecutionId = `${safeId(workflowRunId)}_${safeId(nodeId)}_${attempt}`;
  const dialogProcessId = createWorkflowNodeDialogProcessId(nodeExecutionId);
  const turnScopeId = createWorkflowNodeTurnScopeId(nodeExecutionId);
  return {
    workflowRunId,
    nodeExecutionId,
    nodeId,
    attempt,
    dialogProcessId,
    turnScopeId,
    activeChildExecutionId: deriveAgentExecutionId({ turnScopeId }),
    commandId: deriveTurnCommandId(turnScopeId),
  };
}

export function buildWorkflowPlanningNodeSessions({ workflowRunId, semantic }) {
  const { nodes, flowtos } = semantic;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const isActionNode = (node) => node.type === WORKFLOW_NODE_TYPE.ACTION;
  return nodes.filter(isActionNode).map((node) => {
    const identity = createWorkflowNodeIdentity({ workflowRunId, node, attempt: 1 });
    const dependencies = flowtos
      .filter((edge) => edge.to === identity.nodeId)
      .map((edge) => edge.from)
      .filter((dependencyId) => isActionNode(nodeById.get(dependencyId)));
    return {
      ...identity,
      nodeName: node.name,
      dependencies,
      status: dependencies.length ? WORKFLOW_NODE_STATUS.PENDING : WORKFLOW_NODE_STATUS.READY,
    };
  });
}
